/*
|--------------------------------------------------------------------------
| Search Types
|--------------------------------------------------------------------------
*/

export interface SearchPlayer {
  _id: string;

  playerName: string;

  profileImage?: {
    url: string;

    publicId: string;
  };

  city?: string;

  state?: string;

  playerType?: string;
}

export interface SearchTeam {
  _id: string;

  teamName: string;

  shortName: string;

  logo?: {
    url: string;

    publicId: string;
  };

  city?: string;

  state?: string;
}

export interface SearchGround {
  _id: string;

  groundName: string;

  city?: string;

  state?: string;

  image?: string;
}

export interface SearchTournament {
  _id: string;

  tournamentName: string;

  format: string;

  status: string;
}

export interface GlobalSearchResponse {
  players: SearchPlayer[];

  teams: SearchTeam[];

  grounds: SearchGround[];

  tournaments: SearchTournament[];
}

export interface PlayerSearchByMobileResponse {
  canInvite: boolean;

  alreadyInTeam: boolean;

  pendingInvitation?: boolean;

  player: SearchPlayer;
}