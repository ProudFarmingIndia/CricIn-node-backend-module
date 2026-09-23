import User from "./user.model";

import Ground from "../grounds/ground.model";

/*
|--------------------------------------------------------------------------
| Roles
|--------------------------------------------------------------------------
|
| One login, more than one hat. A club captain who also runs the ground
| behind his house is one human being with one phone number, and the app
| should not ask him to choose.
|
| `roles` is a set that is added to and never swapped, so listing a ground
| does not stop you being a player. `activeRole` is only which navigator
| the app opens in.
|
| THE IMPORTANT PART: activeRole GRANTS NOTHING
|
| It is a client-settable preference, so it can never be a permission. Every
| owner action in the grounds module asks the database who owns that ground
| (see ground.service.assertOwner) rather than what activeRole claims. A
| player who flips the switch by hand gets a different home screen and
| exactly zero extra access.
|
*/

const VALID_ROLES = ["player", "ground_owner", "shop_owner"];

/*
| Called when somebody creates their first ground. Idempotent - $addToSet
| means a second ground changes nothing - and it deliberately does NOT
| touch `activeRole`: an owner mid-way through listing a ground should not
| have the app change navigators under them.
*/

export const grantRole = async (userId: string, role: string) => {
  if (!VALID_ROLES.includes(role)) return null;

  return await User.findByIdAndUpdate(
    userId,
    { $addToSet: { roles: role } },
    { new: true },
  );
};

/*
| What the role switcher renders. `groundCount` is included because the
| owner menu shows "Add your first ground" versus a list, and asking the
| app to make a second call to find that out means a flash of the wrong
| screen.
*/

export const getMyRoles = async (userId: string) => {
  const user: any = await User.findById(userId).select("roles activeRole").lean();

  if (!user) {
    throw new Error("User not found");
  }

  const groundCount = await Ground.countDocuments({ userId });

  /*
  | Owning a ground IS being a ground owner, whatever the roles array says.
  | Deriving it here means an account created before this field existed, or
  | one whose grant failed, still gets its owner menu - the data decides,
  | not a flag that could be out of step with it.
  */

  const roles: string[] = [...new Set([...(user.roles || ["player"]), "player"])];

  if (groundCount > 0 && !roles.includes("ground_owner")) {
    roles.push("ground_owner");

    await grantRole(userId, "ground_owner");
  }

  return {
    roles,

    activeRole: user.activeRole || "player",

    isGroundOwner: roles.includes("ground_owner"),

    groundCount,

    /*
    | A player who has never listed a ground still gets the switch - it is
    | how they discover the feature. Tapping it takes them to the
    | add-a-ground screen rather than an empty dashboard.
    */
    canBecomeGroundOwner: true,
  };
};

/*
| Switching to a role ADDS it, which means anybody can hand themselves
| "ground_owner" by tapping the switch. That is intended: becoming a ground
| owner is self-service - there is no approval queue, and a player who taps
| it lands on the add-a-ground screen with nothing listed.
|
| It is only safe because `roles` is not a permission either. The badge on a
| listing is `isVerified`, set by an admin; the right to edit a ground is
| ownership of that document. Neither can be reached from here.
*/

export const switchRole = async (userId: string, role: string) => {
  if (!VALID_ROLES.includes(role)) {
    throw new Error("Ye role valid nahi hai.");
  }

  const user: any = await User.findByIdAndUpdate(
    userId,
    { $set: { activeRole: role }, $addToSet: { roles: role } },
    { new: true },
  ).select("roles activeRole fullName profileImage");

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};

export const getUserProfile = async (userId: string) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
};

export const updatePushToken = async (userId: string, token: string) => {
  const user = await User.findByIdAndUpdate(
    userId,
    { expoPushToken: token },
    { new: true },
  );

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