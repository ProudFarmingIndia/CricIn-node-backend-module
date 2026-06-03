import Post from "./post.model";
import Like from "./like.model";
import Comment from "./comment.model";

export const createPost =
async (
  userId: string,
  payload: any
) => {

  return await Post.create({
    ...payload,
    userId,
  });
};

export const getFeed =
async () => {

  return await Post.find()
    .populate(
      "userId",
      "fullName profileImage"
    )
    .sort({
      createdAt: -1,
    });
};

export const getPostById =
async (
  postId: string
) => {

  return await Post.findById(
    postId
  ).populate(
    "userId",
    "fullName profileImage"
  );
};

export const likePost =
async (
  userId: string,
  postId: string
) => {

  const existing =
    await Like.findOne({
      userId,
      postId,
    });

  if (existing) {
    return existing;
  }

  await Like.create({
    userId,
    postId,
  });

  await Post.findByIdAndUpdate(
    postId,
    {
      $inc: {
        totalLikes: 1,
      },
    }
  );
};

export const commentPost =
async (
  userId: string,
  postId: string,
  comment: string
) => {

  const newComment =
    await Comment.create({
      userId,
      postId,
      comment,
    });

  await Post.findByIdAndUpdate(
    postId,
    {
      $inc: {
        totalComments: 1,
      },
    }
  );

  return newComment;
};

export const getComments =
async (
  postId: string
) => {

  return await Comment.find({
    postId,
  })
    .populate(
      "userId",
      "fullName profileImage"
    )
    .sort({
      createdAt: -1,
    });
};

export const sharePost =
async (
  postId: string
) => {

  return await Post.findByIdAndUpdate(
    postId,
    {
      $inc: {
        totalShares: 1,
      },
    },
    {
      new: true,
    }
  );
};