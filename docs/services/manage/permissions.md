# Manage Administration Permissions for Users

endpoint: `/api/services/manage/permissions`

method: `PUT`

query parameters: none

## Full Request Body

```json
{
    "phoneNumber": "+919090909090",
    "permissions": {
    	"support": true,
    	"manageTemplates": false
    }
}
```

## Preconditions

* Only a person who has `superUser` set  to `true` in the customClaims can successfully use this endpoint.
