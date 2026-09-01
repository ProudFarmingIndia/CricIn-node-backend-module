/*
|--------------------------------------------------------------------------
| Team Invitation Validation
|--------------------------------------------------------------------------
|
| These helper functions are framework-agnostic.
| You can later replace them with Joi/Zod if needed.
|
*/

export const validateSendInvitation = (
  payload: any
) => {
  const errors: string[] = [];

  if (!payload.teamId) {
    errors.push("teamId is required.");
  }

  if (!payload.playerId) {
    errors.push("playerId is required.");
  }

  if (
    payload.message &&
    payload.message.length > 300
  ) {
    errors.push(
      "Message cannot exceed 300 characters."
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/*
|--------------------------------------------------------------------------
| Validate Invitation Id
|--------------------------------------------------------------------------
*/

export const validateInvitationId = (
  invitationId?: string
) => {
  const errors: string[] = [];

  if (!invitationId) {
    errors.push(
      "Invitation id is required."
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/*
|--------------------------------------------------------------------------
| Validate Accept
|--------------------------------------------------------------------------
*/

export const validateAcceptInvitation = (
  invitationId?: string
) => {
  return validateInvitationId(
    invitationId
  );
};

/*
|--------------------------------------------------------------------------
| Validate Reject
|--------------------------------------------------------------------------
*/

export const validateRejectInvitation = (
  invitationId?: string
) => {
  return validateInvitationId(
    invitationId
  );
};

/*
|--------------------------------------------------------------------------
| Validate Cancel
|--------------------------------------------------------------------------
*/

export const validateCancelInvitation = (
  invitationId?: string
) => {
  return validateInvitationId(
    invitationId
  );
};