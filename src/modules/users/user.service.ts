import User from "./user.model";

export const getUserProfile = async (userId: string) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};

export const updateUserProfile = async (
  userId: string,
  payload: {
    fullName?: string;
    profileImage?: string;
  }
) => {
  const user = await User.findByIdAndUpdate(
    userId,
    payload,
    {
      new: true,
      runValidators: true,
    }
  );

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};