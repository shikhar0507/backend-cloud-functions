# Manage Administration Permissions for Users

endpoint: `/api/services/permissions`

method: `PUT`

query parameters: none

## Full Request Body

```json
{
    "phoneNumber": "+919090909090",
    "field": true
}
```

> A user can only have one permission at most.
> On every successful permission update, the existing permissions are replaced.

## Supported Permissions (field)

* `manageTemplates`
* `support`

## Preconditions

* Only a person who has `superUser` in the `customClaims` can successfully use this endpoint.
* You cannot grant yourself permissions. This means that, if the `phoneNumber` in the request body is the same phone number which you are logged-in with; your request will be rejected.
