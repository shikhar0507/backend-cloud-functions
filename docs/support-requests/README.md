# Handling Support Requests

There are no special endpoints for support requests. Instead, `support` is a special permission given to a user of the platform.

## Support Privilidges

A person with `support` has the following privilidges:

* Can create activities without them being asignees of the activity themselves.

* Can edit the activity without being an assignee.

## Sending A Support Request

The endpoints which employ a support request are the following:

1. `/api/activities/create`
2. `/api/activities/share`
3. `/api/activities/change-status`
4. `/api/activities/share`
5. `/api/activities/remove`
6. `/api/activities/comment`

* A person with support privilidge can create an activity without the need of subsciption to the template required to create the activity.

To distinguish a normal request from a support request, you have to add a query parameter `support` to your request URL.

*example*: `/api/activities/create?support=true`

For the `/create` endpoint , you also need to add the
`canEditRule` in the request body in the support requests.

* Example Request Body:

```json
{
    "activityId": "IG7kfhUnS2FqSe9qDuyj",
    "timestamp": 1528175958053,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030614
    },
    "canEditRule": "ALL"
}
```

The valid values for the `canEditRule` can be one of the following:

* `ALL`
* `NONE`
* `PEOPLE_TYPE`
* `CREATOR`
* `FROM_INCLUDE`

Sending anything else will result in a failed request.
