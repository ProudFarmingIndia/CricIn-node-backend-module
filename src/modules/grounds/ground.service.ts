import Ground from "./ground.model";

export const createGround =
  async (
    userId: string,
    payload: any
  ) => {

    return await Ground.create({
      ...payload,
      userId,
    });
  };

export const getGrounds =
  async (
    userId: string
  ) => {

    return await Ground.find({
      userId,
    });
  };

export const getAllGrounds =
  async () => {

    return await Ground.find();
  };

export const getGroundById =
  async (
    groundId: string
  ) => {

    return await Ground.findById(
      groundId
    );
  };

export const updateGround =
  async (
    groundId: string,
    payload: any
  ) => {

    return await Ground.findByIdAndUpdate(
      groundId,
      payload,
      {
        new: true,
      }
    );
  };

export const deleteGround =
  async (
    groundId: string
  ) => {

    return await Ground.findByIdAndDelete(
      groundId
    );
  };