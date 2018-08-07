# Changing The Current Status of An Existing Activity

* endpoint: `/api/activities/change-status`

* method: `PATCH`

* query parameters: `support` (optional)

## Full Request Body

```json
{
    "activityId": "z8ifrds0uSeWQoWuWJoX",
    "timestamp": 1529650294688,
    "geopoint": {
        "latitude": 28.5482662,
        "longitude": 77.2030614
    },
    "status": "VALUE"
}
```

## Valid Values for the Status

* `PENDING`
* `CONFIRMED`
* `CANCELLED`

## Preconditions

* An activity with the `activityId` from the request body must exist.

* You must have edit rights to the activity.

* You must be an `assignee` of the activity.
