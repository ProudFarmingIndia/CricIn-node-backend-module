import Player from "../players/player.model";
import User from "../users/user.model";
import Team from "../teams/team.model";
import Ground from "../grounds/ground.model";
import Tournament from "../tournaments/tournament.model";
import { MAX_SEARCH_RESULTS } from "../common/constants/search.constants";
import { createRegex } from "../common/helpers/regex.helper";

import { getFollowedTargetKeys } from "../follows/follow.service";

/*
|--------------------------------------------------------------------------
| Follow State On Search Results
|--------------------------------------------------------------------------
|
| Every search result needs a Follow / Following button in the right state.
| Asking per row would be one query per result; this resolves the whole
| page in a single query and stamps `isFollowing` onto each document.
|
| Mongoose documents are converted with toObject() first - assigning an
| undeclared field to a hydrated document is silently dropped on
| serialisation, so the flag would never have reached the client.
|
| followerCount is normalised here too. Player stores it as `followers` and
| Team as `followersCount`, and a count that drifted negative through a
| lost decrement is clamped to zero rather than rendered as "-1 followers".
|
*/

const attachFollowState = async (
  viewerUserId: string,
  players: any[],
  teams: any[],
) => {
  const targets = [
    ...players.map((p) => ({
      targetType: "PLAYER",
      targetId: String(p._id),
    })),

    ...teams.map((t) => ({
      targetType: "TEAM",
      targetId: String(t._id),
    })),
  ];

  const followedKeys = await getFollowedTargetKeys(viewerUserId, targets);

  const decoratedPlayers = players.map((p) => {
    const plain = typeof p.toObject === "function" ? p.toObject() : { ...p };

    return {
      ...plain,

      isFollowing: followedKeys.has(`PLAYER:${String(p._id)}`),

      followerCount: Math.max(0, plain.followers || 0),

      /*
      | Local players have no account behind them, so there is nobody to
      | notify and nothing to follow for updates. The client uses this to
      | hide the button rather than showing one that always errors.
      */
      canFollow: !plain.isLocal && !!plain.userId,
    };
  });

  const decoratedTeams = teams.map((t) => {
    const plain = typeof t.toObject === "function" ? t.toObject() : { ...t };

    return {
      ...plain,

      isFollowing: followedKeys.has(`TEAM:${String(t._id)}`),

      followerCount: Math.max(0, plain.followersCount || 0),

      canFollow: true,
    };
  });

  return {
    players: decoratedPlayers,

    teams: decoratedTeams,
  };
};

/*
|--------------------------------------------------------------------------
| Global Search
|--------------------------------------------------------------------------
|
| Used from Header Search
|
| Searches:
| Players
| Teams
| Grounds
| Tournaments
|
*/

export const globalSearch = async (keyword: string, userId: string) => {
  if (!keyword.trim()) {
    return {
      players: [],
      teams: [],
      grounds: [],
      tournaments: [],
    };
  }

  const regex = createRegex(keyword);

  /*
  |--------------------------------------------------------------------------
  | Players
  |--------------------------------------------------------------------------
  |
  | Brought in line with searchPlayers() below, which this endpoint is now
  | the front door for. It previously differed in two ways that showed up
  | as bugs on the client:
  |
  |   - It matched playerName only, so searching a phone number or the
  |     User's fullName found nothing here while the Players tab found the
  |     player immediately - the same query returning different answers
  |     depending on which tab you were on.
  |
  |   - It did not exclude the caller, so every user saw themselves in
  |     their own search results.
  |
  */

  const currentPlayer = await Player.findOne({
    userId,
  });

  const matchingUsers = await User.find({
    $or: [{ phone: regex }, { fullName: regex }],
  }).select("_id");

  const matchingUserIds = matchingUsers.map((u) => u._id);

  const players = await Player.find({
    $or: [
      {
        playerName: regex,
      },

      {
        userId: {
          $in: matchingUserIds,
        },
      },

      {
        mobile: regex,
      },
    ],

    ...(currentPlayer && {
      _id: {
        $ne: currentPlayer._id,
      },
    }),
  })
    .populate({
      path: "userId",
      select: "phone fullName profileImage",
    })
    .limit(MAX_SEARCH_RESULTS);

  /*
  |--------------------------------------------------------------------------
  | Teams
  |--------------------------------------------------------------------------
  |
  | visibility was not filtered here, so global search leaked private teams
  | that searchTeams() deliberately hides. Sorted and populated to match it
  | too, so the same team renders identically in both tabs.
  |
  */

  const teams = await Team.find({
    isActive: true,

    visibility: "public",

    $or: [
      {
        teamName: regex,
      },

      {
        shortName: regex,
      },

      {
        city: regex,
      },

      {
        state: regex,
      },
    ],
  })
    .populate("captainId", "playerName profileImage")
    .populate("viceCaptainId", "playerName profileImage")
    .limit(MAX_SEARCH_RESULTS)
    .sort({
      totalMatches: -1,
    });

  /*
  |--------------------------------------------------------------------------
  | Grounds
  |--------------------------------------------------------------------------
  */

  const grounds = await Ground.find({
    isActive: true,

    $or: [
      {
        groundName: regex,
      },

      {
        city: regex,
      },

      {
        state: regex,
      },
    ],
  }).limit(MAX_SEARCH_RESULTS);

  /*
  |--------------------------------------------------------------------------
  | Tournaments
  |--------------------------------------------------------------------------
  */

  const tournaments = await Tournament.find({
    tournamentName: regex,
  }).limit(MAX_SEARCH_RESULTS);

  /*
  | Stamps isFollowing / followerCount / canFollow onto each player and
  | team, so the search cards can show a Follow button in the correct state
  | without a second request per row.
  */

  const decorated = await attachFollowState(userId, players, teams);

  return {
    players: decorated.players,

    teams: decorated.teams,

    grounds,

    tournaments,
  };
};

/*
|--------------------------------------------------------------------------
| Search Players
|--------------------------------------------------------------------------
|
| Used in:
| - Global Player Search
| - Find Players Screen
|
*/

export const searchPlayers = async (
  keyword: string,
  userId: string,
) => {
  if (!keyword.trim()) {
    return [];
  }

  const regex = createRegex(keyword);

  const currentPlayer = await Player.findOne({
    userId,
  });

  /*
  ----------------------------------------------------
  Find matching users first
  ----------------------------------------------------
  */

  const users = await User.find({
    $or: [
      { phone: regex },
      { fullName: regex },
    ],
  }).select("_id");

  const userIds = users.map((u) => u._id);

  /*
  ----------------------------------------------------
  Search players
  ----------------------------------------------------
  */

  const players = await Player.find({
    $or: [
      {
        playerName: regex,
      },
      {
        userId: {
          $in: userIds,
        },
      },
      {
        mobile: regex,
      },
    ],

    ...(currentPlayer && {
      _id: {
        $ne: currentPlayer._id,
      },
    }),
  })
    .populate({
      path: "userId",
      select: "phone fullName profileImage",
    })
    .limit(MAX_SEARCH_RESULTS);

  const decorated = await attachFollowState(userId, players, []);

  return decorated.players;
};

/*
|--------------------------------------------------------------------------
| Search Player By Mobile
|--------------------------------------------------------------------------
|
| Used while inviting player into team.
|
*/

export const searchPlayerByMobile = async (mobile: string, userId: string) => {
  if (!mobile.trim()) {
    throw new Error("Mobile number is required.");
  }

  /*
    |--------------------------------------------------------------------------
    | Find User
    |--------------------------------------------------------------------------
    */

  const user = await User.findOne({
    phone: mobile,
  });

  if (!user) {
    throw new Error("Player not found.");
  }

  /*
    |--------------------------------------------------------------------------
    | Logged-in User
    |--------------------------------------------------------------------------
    */

  if (user._id.equals(userId)) {
    throw new Error("You cannot invite yourself.");
  }

  /*
    |--------------------------------------------------------------------------
    | Player Profile
    |--------------------------------------------------------------------------
    */

  const player = await Player.findOne({
    userId: user._id,
  })
    .populate({
      path: "userId",
      select: "phone fullName profileImage",
    })
    .populate("teams");

  if (!player) {
    throw new Error("Player profile not found.");
  }

  /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

  return {
    canInvite: true,

    alreadyInTeam: false,

    player,
  };
};

/*
|--------------------------------------------------------------------------
| Search Teams
|--------------------------------------------------------------------------
|
| Used In:
| - Find Teams Screen
| - Team Search
|
*/

/*
| Now takes the caller's userId so each result can carry the viewer's
| follow state. It is optional so the existing call sites that pass only a
| keyword keep compiling - they just get every button in the "Follow"
| state, which is correct for an anonymous view.
*/

export const searchTeams = async (keyword: string, userId?: string) => {
  if (!keyword.trim()) {
    return [];
  }

  const regex = createRegex(keyword);

  const teams = await Team.find({
    isActive: true,

    visibility: "public",

    $or: [
      {
        teamName: regex,
      },

      {
        shortName: regex,
      },

      {
        city: regex,
      },

      {
        state: regex,
      },
    ],
  })
    .populate("captainId", "playerName profileImage")
    .populate("viceCaptainId", "playerName profileImage")
    .limit(MAX_SEARCH_RESULTS)
    .sort({
      totalMatches: -1,
    });

  const decorated = await attachFollowState(userId || "", [], teams);

  return decorated.teams;
};

/*
|--------------------------------------------------------------------------
| Search Grounds
|--------------------------------------------------------------------------
*/

export const searchGrounds = async (keyword: string) => {
  if (!keyword.trim()) {
    return [];
  }

  const regex = createRegex(keyword);

  return await Ground.find({
    isActive: true,

    $or: [
      {
        groundName: regex,
      },

      {
        city: regex,
      },

      {
        state: regex,
      },

      {
        address: regex,
      },
    ],
  })
    .limit(MAX_SEARCH_RESULTS)
    .sort({
      createdAt: -1,
    });
};

/*
|--------------------------------------------------------------------------
| Search Tournaments
|--------------------------------------------------------------------------
*/

export const searchTournaments = async (keyword: string) => {
  if (!keyword.trim()) {
    return [];
  }

  const regex = createRegex(keyword);

  return await Tournament.find({
    $or: [
      {
        tournamentName: regex,
      },

      {
        description: regex,
      },

      {
        format: regex,
      },
    ],
  })
    .populate("winnerTeam", "teamName shortName logo")
    .limit(MAX_SEARCH_RESULTS)
    .sort({
      startDate: -1,
    });
};

/*
|--------------------------------------------------------------------------
| Search Suggestions
|--------------------------------------------------------------------------
*/

export const getSearchSuggestions = async (keyword: string) => {
  if (keyword.trim().length < 2) {
    return [];
  }

  const regex = createRegex(keyword);

  const [players, teams, grounds] = await Promise.all([
    Player.find({
      playerName: regex,
    })
      .select("playerName profileImage")
      .limit(5),

    Team.find({
      teamName: regex,
      isActive: true,
    })
      .select("teamName shortName logo")
      .limit(5),

    Ground.find({
      groundName: regex,
      isActive: true,
    })
      .select("groundName city state")
      .limit(5),
  ]);

  return {
    players,

    teams,

    grounds,
  };
};

/*
|--------------------------------------------------------------------------
| Search By Id
|--------------------------------------------------------------------------
*/

export const getPlayerById = async (playerId: string) => {
  return Player.findById(playerId)
    .populate({
      path: "userId",

      select: "phone fullName profileImage",
    })
    .populate("teams");
};

export const getTeamById = async (teamId: string) => {
  return Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

export const getGroundById = async (groundId: string) => {
  return Ground.findById(groundId);
};

export const getTournamentById = async (tournamentId: string) => {
  return Tournament.findById(tournamentId)
    .populate("winnerTeam")
    .populate("teams");
};

/*
|--------------------------------------------------------------------------
| Future Search Features
|--------------------------------------------------------------------------
|

✔ Search Suggestions

✔ Recent Searches

✔ Trending Searches

✔ Popular Players

✔ Verified Teams

✔ Nearby Grounds

✔ Suggested Players

✔ Suggested Teams

✔ Search Analytics

✔ Elasticsearch

✔ Algolia

✔ AI Search

*/
