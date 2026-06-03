import Follow from "./follow.model";

export const follow = async (
  followerId: string,
  payload: any
) => {

  return await Follow.create({
    followerId,
    ...payload,
  });
};

export const unfollow = async (
  followerId: string,
  targetId: string
) => {

  return await Follow.findOneAndDelete({
    followerId,
    targetId,
  });
};

export const getMyFollowing =
  async (
    followerId: string
  ) => {

    return await Follow.find({
      followerId,
      status: "ACCEPTED",
    });
  };

export const getFollowers =
  async (
    targetId: string
  ) => {

    return await Follow.find({
      targetId,
      status: "ACCEPTED",
    });
  };

export const acceptFollowRequest =
  async (
    followId: string
  ) => {

    return await Follow.findByIdAndUpdate(
      followId,
      {
        status: "ACCEPTED",
      },
      {
        new: true,
      }
    );
  };