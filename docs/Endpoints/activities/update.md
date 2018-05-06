# Updating an existing activity

**Endpoint**: `/app/activities/update`

**Method**: PATCH

## Example request body

```json
{
    "activityId": "gnCuHnQQOvQGsWtFxmqQ",
    "timestamp": 1522598642000,
    "geopoint": [80.2333, 30.3434],
    "title": "new updated title",
    "description": "new changed description",
    "status": "a valid status",
    "deleteAssignTo": ["+919090909909"],
    "addAssignTo": ["+918080808080"],
    "venue": [{
        "venueDescriptor": "where",
        "location": "location name",
        "geopoint": [80.80,90.0],
        "address": "address of the venue"
    },
    {
        "venueDescriptor": "where",
        "location": "second location name",
        "geopoint": [72.11,90.99],
        "address": "address of the venue"
    }],
    "schedule": [{
        "name": "when",
        "startTime": 1520015400000,
        "endTime": 1520101800000
    },
    {
        "name": "when",
        "startTime": 1520274600000, // startTime > endTime here. This schedule will be ignored
        "endTime": 1520188200000
    }]
}
```

## Minimal request body

Here's an example of the the least amount of fields that you can use to update an activity.

```json
    "activityId": "gnCuHnQQOvQGsWtFxmqQ",
    "timestamp": 1522598642000,
    "geopoint": [80.2333, 30.3434],
```

This request will only add an addendum to the activity with the updated time and geopoint coords that you send in the request body.

## Fields

* **activityId**: A non-null non-empty string containing the id of the activity which you want to update.

* **timestamp**: A non-null non-empty Number (or `long` for Java) containing the unix timestamp denoting the time at which you hit the endpoint.

* **geopoint**: A non-empty array containing the latitude and longitude of the client at the time of creating the activity.

  * form: [`lat`, `lng`]

  * lat range: -90 <= `lat` <= 90

  * lng range: -180 <= `lng` <= 180

* **title**: A nullable string (can be empty) with the title of the activity.

* **description**: A nullable string (can be empty) with the description of the activity.

* **addAssignTo**: A nullable array containing the phone numbers of all the participants of the activity.

  * Only valid phone numbers will be added to the activity in creation.

  * Make sure to add a `+` to each of the phone numbers. See notes in `/create` for more details.

* **deleteAssignTo**: A nullable array containing the phone numbers of all the participants of the activity which you want to remove.

  * Make sure to add a `+` to each of the phone numbers. See notes in `/create` for more details.

* **venue**: A nullable array containing the venues you want to add to the activity.

  * Venue can be an empty array.

  * Only `venueDescriptor`, `location`, `geopoint`, and `address` fields are accepted. Anything else will be discarded.

  * A venue object without the `geopoint` field will be ignored. All other fields are optional.

* **schedule**: A nullable array containing the schedules ou want to add to the activity.

  * Can be an empty array.

  * Only `name`, `startTime`, and `endTime` fields are accepted. Anything else will be ignored.

  * A schedule without `startTime` will be ignored. All other fields are optional.

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `204`: NO CONTENT: The activity was updated successfully and there was nothing to send in the response body.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `PATCH` is allowed for `/update`.

* `409`: CONFLICT: A document with the activity-id you sent in the request doesn't exist.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
