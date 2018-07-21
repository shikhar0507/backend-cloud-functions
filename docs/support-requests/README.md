# Handling Support Requests

There are no special endpoints for support requests. Instead, `support` is a custom claim given to a user on the platform.

## Support Privilidges

A person with the `support` custom claim has the following privilidges:

* Can create activities without them being asignees of the activity themselves.

* Can edit the activity without being an assignee.

* Don't need the subscription of the office + template for which they want to create/update an activity.

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
*example*: `/api/activities/comment?support=true`

> For the `/create` endpoint , you also need to add the `canEditRule` in the request body in the support requests.

* Example Request Body

For `/create`

```json
{
    "activityId": "IG7kfhUnS2FqSe9qDuyj",
    "timestamp": 1528175958053,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030614
    },
    "title": "Hello World :)",
    "canEditRule": "VALUE"
}
```

For `/comment`

```json
{
    "activityId": "IG7kfhUnS2FqSe9qDuyj",
    "timestamp": 1528175958053,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030614
    },
    "comment": "Hi, there. This is a test comment...",
    "canEditRule": "VALUE"
}
```

> The valid values for the `canEditRule` can be one of the following:

* `ALL`
* `NONE`
* `PEOPLE_TYPE`
* `CREATOR`
* `FROM_INCLUDE`

Sending anything else will result in a failed request.
