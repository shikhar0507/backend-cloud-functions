# Handling Support Requests

There are no special endpoints for support requests. Instead, `support` is a special permission given to a user of the platform.

## Support Privilidges

A person belonging`support` has the following privilidges:

* Can edit activities where they are not an assignee of.

## Sending A Support Request

The endpoints which employ a support request are the following:

1. `/api/activities/create`
2. `/api/activities/share`
3. `/api/activities/change-status`
4. `/api/activities/share`
5. `/api/activities/remove`
6. `/api/activities/comment`

* A person with support privilidge can create an activity without the need of subsciption to the template required to create the activity.

> The same conditions apply to `/share` too.

To distinguish a normal request from a support request, you have to add a query parameter `as` to your request URL.

`/api/activities/create?as=support`

With such a request, you will also need to include a field `canEditRule` to the request body.

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
