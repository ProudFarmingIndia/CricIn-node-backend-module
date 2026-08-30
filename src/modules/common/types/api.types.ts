/*
|--------------------------------------------------------------------------
| Common API Response
|--------------------------------------------------------------------------
*/

export interface ApiResponse<T = any> {
  success: boolean;

  message?: string;

  data: T;
}

/*
|--------------------------------------------------------------------------
| API Error Response
|--------------------------------------------------------------------------
*/

export interface ApiErrorResponse {
  success: false;

  message: string;

  errors?: any;
}

/*
|--------------------------------------------------------------------------
| Pagination
|--------------------------------------------------------------------------
*/

export interface Pagination {
  page: number;

  limit: number;

  total: number;

  totalPages: number;

  hasNextPage: boolean;

  hasPreviousPage: boolean;
}

/*
|--------------------------------------------------------------------------
| Paginated API Response
|--------------------------------------------------------------------------
*/

export interface PaginatedResponse<T = any> {
  success: boolean;

  message?: string;

  data: T[];

  pagination: Pagination;
}

/*
|--------------------------------------------------------------------------
| Generic Query
|--------------------------------------------------------------------------
*/

export interface QueryParams {
  page?: number;

  limit?: number;

  search?: string;

  sortBy?: string;

  sortOrder?: "asc" | "desc";
}

/*
|--------------------------------------------------------------------------
| Search Query
|--------------------------------------------------------------------------
*/

export interface SearchQuery {
  q: string;
}

/*
|--------------------------------------------------------------------------
| Mobile Search Query
|--------------------------------------------------------------------------
*/

export interface MobileSearchQuery {
  mobile: string;
}

/*
|--------------------------------------------------------------------------
| Mongo Id Params
|--------------------------------------------------------------------------
*/

export interface IdParams {
  id: string;
}

/*
|--------------------------------------------------------------------------
| Team Params
|--------------------------------------------------------------------------
*/

export interface TeamParams {
  teamId: string;
}

/*
|--------------------------------------------------------------------------
| Player Params
|--------------------------------------------------------------------------
*/

export interface PlayerParams {
  playerId: string;
}

/*
|--------------------------------------------------------------------------
| Invitation Params
|--------------------------------------------------------------------------
*/

export interface InvitationParams {
  invitationId: string;
}

/*
|--------------------------------------------------------------------------
| Timestamp
|--------------------------------------------------------------------------
*/

export interface Timestamp {
  createdAt: Date;

  updatedAt: Date;
}