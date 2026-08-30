export const createRegex = (
  value: string
) => {
  return new RegExp(
    value.trim(),
    "i"
  );
};