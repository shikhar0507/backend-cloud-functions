# Adding a comment to an existing activity

**ENDPOINT**: `/app/activities/comment`

**METHOD**: POST

## Example request body

```json
{
    "activityId": "2k4qI3W39sKIDZedcOaM",
    "timestamp": 1522598642000,
    "geopoint": [80.2333, 30.343],
    "comment": "An example comment"
}
```

## Fields

* **ActivityId**: A non-null non-empty string containing the id of the activity which you want to add a comment to.

* **timestamp**: A non-null non-empty Number (or `long` for Java) containing the Unix timestamp denoting the time at which you hit the endpoint.

* **geopoint**: A non-empty array containing the latitude and longitude of the client at the time of creating the activity.

  * form: [`lat`, `lng`]

  * lat range: -90 <= `lat` <= 90

  * lng range: -180 <= `lng` <= 180

* **comment**: A non-null non-empty string containing the comment which you add to the activity.

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `201`: CREATED: A document with the comment in from the request has been created successfully.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `POST` is allowed for `/comment`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
