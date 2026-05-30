import Team from "./team.model";

export const createTeam = async (
  userId: string,
  payload: any
) => {
  return await Team.create({
    ...payload,
    userId,
  });
};

export const getTeams = async (
  userId: string
) => {
  return await Team.find({ userId })
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

export const getTeamById = async (
  teamId: string
) => {
  return await Team.findById(teamId)
    .populate("captainId")
    .populate("viceCaptainId")
    .populate("players");
};

export const updateTeam = async (
  teamId: string,
  payload: any
) => {
  return await Team.findByIdAndUpdate(
    teamId,
    payload,
    {
      new: true,
    }
  );
};

export const deleteTeam = async (
  teamId: string
) => {
  return await Team.findByIdAndDelete(
    teamId
  );
};

export const addPlayerToTeam = async (
  teamId: string,
  playerId: string
) => {
  return await Team.findByIdAndUpdate(
    teamId,
    {
      $addToSet: {
        players: playerId,
      },
    },
    {
      new: true,
    }
  );
};

export const removePlayerFromTeam = async (
  teamId: string,
  playerId: string
) => {
  return await Team.findByIdAndUpdate(
    teamId,
    {
      $pull: {
        players: playerId,
      },
    },
    {
      new: true,
    }
  );
};

export const setCaptain = async (
  teamId: string,
  captainId: string
) => {
  return await Team.findByIdAndUpdate(
    teamId,
    {
      captainId,
    },
    {
      new: true,
    }
  );
};