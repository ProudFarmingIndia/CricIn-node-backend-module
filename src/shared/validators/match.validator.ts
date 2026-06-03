export const validateMatch =
(
  req: any,
  res: any,
  next: any
) => {

  const {
    teamA,
    teamB
  } = req.body;

  if (
    teamA === teamB
  ) {
    return res.status(400)
      .json({
        success:false,
        message:
        "Both teams cannot be same"
      });
  }

  next();
};