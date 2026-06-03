import Tournament from "./tournament.model";

export const createTournament =
  async (
    userId: string,
    payload: any
  ) => {

    return await Tournament.create({
      ...payload,
      userId,
    });
  };

export const getTournaments =
  async (
    userId: string
  ) => {

    return await Tournament.find({
      userId,
    })
      .populate("teams")
      .populate("winnerTeam");
  };

export const getTournamentById =
  async (
    tournamentId: string
  ) => {

    return await Tournament.findById(
      tournamentId
    )
      .populate("teams")
      .populate("winnerTeam");
  };

export const updateTournament =
  async (
    tournamentId: string,
    payload: any
  ) => {

    return await Tournament.findByIdAndUpdate(
      tournamentId,
      payload,
      {
        new: true,
      }
    );
  };

export const deleteTournament =
  async (
    tournamentId: string
  ) => {

    return await Tournament.findByIdAndDelete(
      tournamentId
    );
  };

export const addTeamToTournament =
  async (
    tournamentId: string,
    teamId: string
  ) => {

    return await Tournament.findByIdAndUpdate(
      tournamentId,
      {
        $addToSet: {
          teams: teamId,
        },
      },
      {
        new: true,
      }
    );
  };

export const removeTeamFromTournament =
  async (
    tournamentId: string,
    teamId: string
  ) => {

    return await Tournament.findByIdAndUpdate(
      tournamentId,
      {
        $pull: {
          teams: teamId,
        },
      },
      {
        new: true,
      }
    );
  };

export const completeTournament =
  async (
    tournamentId: string,
    winnerTeam: string
  ) => {

    return await Tournament.findByIdAndUpdate(
      tournamentId,
      {
        winnerTeam,
        status: "completed",
      },
      {
        new: true,
      }
    );
  };