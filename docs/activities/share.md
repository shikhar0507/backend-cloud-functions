# Adding (assign) Someone To An Existing Activity

endpoint: `/api/activities/share`

method: `PATCH`

query parameters: `as` (optional)

> The `as` query parameter can be used by a privilidged user to make a support request for creating an activity.
> The URL for the support request should look like this: `/api/activities/share?as=support`
> For support requests, you *don't* need to be an assignee of the activity.

## Full Request Body

```json
{
    "activityId": string --> activityId,
    "timestamp": number --> unix timestamp,
    "geopoint": {
        latitude: number,
        longitude: number
    },
    "share": [multiple strings --> phone numbers]
}
```

## Preconditions

* An activity with the `activityId` from the request body must exist.

* You must have edit rights to the activity.

* You must be an assignee of the activity.
