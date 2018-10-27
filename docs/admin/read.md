# Read API for admin app

endpoint: `/api/admin/read`

method: `GET`

query parameter: `from` (required) and `office` (required)

## Response Body

Same as the frontend-app.

## Preconditions

* Users with `admin` or `support` customClaims can access this endpoint.
