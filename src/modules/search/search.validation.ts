/*
|--------------------------------------------------------------------------
| Search Validation
|--------------------------------------------------------------------------
*/

import { MIN_SEARCH_LENGTH } from "../common/constants/search.constants";

/*
|--------------------------------------------------------------------------
| Global Search
|--------------------------------------------------------------------------
*/

export const validateGlobalSearch = (
  keyword: string
) => {
  if (!keyword?.trim()) {
    throw new Error(
      "Search keyword is required."
    );
  }

  if (
    keyword.trim().length <
    MIN_SEARCH_LENGTH
  ) {
    throw new Error(
      `Search keyword must contain at least ${MIN_SEARCH_LENGTH} characters.`
    );
  }
};

/*
|--------------------------------------------------------------------------
| Player Name Search
|--------------------------------------------------------------------------
*/

export const validatePlayerSearch = (
  keyword: string
) => {
  validateGlobalSearch(keyword);
};

/*
|--------------------------------------------------------------------------
| Player Mobile Search
|--------------------------------------------------------------------------
*/

export const validatePlayerMobile = (
  mobile: string
) => {
  if (!mobile?.trim()) {
    throw new Error(
      "Mobile number is required."
    );
  }

  if (
    !/^[6-9]\d{9}$/.test(
      mobile
    )
  ) {
    throw new Error(
      "Invalid mobile number."
    );
  }
};

/*
|--------------------------------------------------------------------------
| Team Search
|--------------------------------------------------------------------------
*/

export const validateTeamSearch = (
  keyword: string
) => {
  validateGlobalSearch(keyword);
};

/*
|--------------------------------------------------------------------------
| Ground Search
|--------------------------------------------------------------------------
*/

export const validateGroundSearch = (
  keyword: string
) => {
  validateGlobalSearch(keyword);
};

/*
|--------------------------------------------------------------------------
| Tournament Search
|--------------------------------------------------------------------------
*/

export const validateTournamentSearch =
  (
    keyword: string
  ) => {
    validateGlobalSearch(
      keyword
    );
  };