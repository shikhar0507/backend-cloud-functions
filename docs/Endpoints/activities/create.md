# Creating a new activity

**Endpoint**: `/app/activities/create`

**Method**: POST

## Example request body

```json
{
    "templateId": "plan",
    "timestamp": 1520015400000,
    "officeId": "OsUR4ANqFzfKxyWBCS0r",
    "geopoint": [80.2333, 30.3434],
    "title": "Title of the activity",
    "description": "Description of the activity.",
    "assignTo": [
        "+919090909090",
        "+919019191919"
    ],
    "venue": [{
        "venueDescriptor": "venue description",
        "location": "location name",
        "geopoint": [80.80,90.0],
        "address": "address of the venue"
    },
    {
        "venueDescriptor": "another venue description",
        "location": "second location name",
        "geopoint": [72.11,90.99],
        "address": "address of the venue"
    }],
    "schedule": [{
        "name": "Valid schedule",
        "startTime": 1520015400000,
        "endTime": 1520101800000
    },
    {
        "name": "Invalid Schedule", // startTime > endTime here. This schedule will be ignored
        "startTime": 1520274600000,
        "endTime": 1520188200000
    }]
}
```

## Fields

* **templateId**: A non-null non-empty string containing the id of the template with which you want to create the activity with.

* **timestamp**: A non-null non-empty `Number` (`long` for Java) containing the unix timestamp denoting the time at which you hit the endpoint.

* **officeId**: A non-null non-empty string containing the id of the office with which you want to create the activity with.

* **geopoint**: A non-empty array containing the latitude and longitude of the client at the time of creating the activity.

    * form: [`lat`, `lng`]

    * lat range: -90 <= `lat` <= 90

    * lng range: -180 <= `lng` <= 180

* **title**: A nullable string (can be empty) with the title of the activity.

* **description**: A nullable string (can be empty) with the description of the activity.

* **assignTo**: A nullable array containing the phone numbers of all the participants of the activity.

    * Only valid phone numbers will be added to the activity in creation.

    * Make sure to add a `+` to each of the phone numbers. See notes below for more details.

* **venue**: A nullable array containing the venues you want to add to the activity.

    * Venue can be an empty array.

    * Only `venueDescriptor`, `location`, `geopoint`, and `address` fields are accepted. Anything else will be discarded.

    * A venue object without the `geopoint` field will be ignored. All other fields are optional.

* **schedule**: A nullable array containing the schedules ou want to add to the activity.

    * Can be an empty array.

    * Only `name`, `startTime`, and `endTime` fields are accepted. Anything else will be ignored.

    * A schedule without `startTime` will be ignored. All other fields are optional.

****

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `201`: CREATED: The activity was created on the server with the request body you sent.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `POST` is allowed for `/create`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.

## Notes

A few things you should consider while creating a request on `/create`:

### Phone Numbers

If you want to add assignees while creating an activity, please make sure that you properly _filter_ the mobile numbers list so that you don't accidentally waste your request.

Phone numbers in user devices are generally stored in multiple ways. A few common ways in which you will find them are as follows:

eg number: +919090909090

1. +919090909090

2. 9090909090

3. 09090909090

4. 909-090-9090

5. 909 090 9090

6. 0909 090 9090

7. 919090909090


If you send all of these numbers in the request body, only the first number (+919090909090) will be added to the activity.

Also please try to make sure to handle duplication in the array.
