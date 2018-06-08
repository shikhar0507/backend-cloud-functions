# Manage Administration Permissions for Users

endpoint: `/api/services/manage/permissions`

method: `PUT`

query parameters: none

## Full Request Body

```json
{
    "phoneNumber": "+919090909090",
    "field": "value"
}
```

> A user can only have one permission, at most. This means that if the person that you are trying to grant a permission to already has one permission, your request will be rejected.

## Supported Permissions (field)

* `manageTemplates`
* `support`

## Preconditions

* Only a person who has `superUser` set  to `true` in the customClaims can successfully use this endpoint.
* You cannot grant yourself permissions. This means that, if the `phoneNumber` in the request body is the same phone number which you are logged-in with, your request will be rejected.
