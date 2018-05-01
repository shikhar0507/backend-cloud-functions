# Reading updates and activities

**ENDPOINT**: /app/activities/read

**METHOD**: GET

## Example Response

```json
{
    "addendum": {
        "0": {
            "activityId": "zE52PotR1u94AmVcnqal",
            "comment": "+919090909090 created Plan",
            "timestamp": "Fri, 02 Mar 2018 18:30:00 GMT",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+919090909090"
        },
        "1": {
            "activityId": "zE52PotR1u94AmVcnqal",
            "comment": "create a new doc in addendum with this comment",
            "timestamp": "Sun, 01 Apr 2018 16:04:02 GMT",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+919090909090"
        },
    },
    "updates": {
        "zE52PotR1u94AmVcnqal": {
            "status": "PENDING",
            "schedule": {},
            "venue": {},
            "timestamp": "Fri, 02 Mar 2018 18:30:00 GMT",
            "template": "plan",
            "title": "NEW TITLE",
            "description": "Another updated description",
            "office": "OsUR4ANqFzfKxyWBCS0r"
        },
        "nkPYPcCrQH7YN5ORimOc": {
            "status": "PENDING",
            "schedule": {
                "0": {
                    "endTime": "2018-04-21T18:30:00.000Z",
                    "startTime": "2018-04-18T18:30:00.000Z",
                    "name": "1 schedule"
                },
                "1": {
                    "startTime": "2018-04-20T18:30:00.000Z",
                    "name": "2 schedule",
                    "endTime": "2018-04-23T18:30:00.000Z"
                },
                "2": {
                    "startTime": "2018-04-24T18:30:00.000Z",
                    "name": "3 schedule",
                    "endTime": "2018-04-24T18:30:00.000Z"
                }
            },
            "venue": {
                "0": {
                    "location": "location name",
                    "venueDescriptor": "venue description",
                    "geopoint": {
                        "_latitude": 12.8,
                        "_longitude": 20
                    },
                    "address": "address of the venue"
                },
                "1": {
                    "venueDescriptor": "another venue description",
                    "geopoint": {
                        "_latitude": 72.11,
                        "_longitude": 80.99
                    },
                    "address": "address of the venue",
                    "location": "second location name"
                }
            },
            "timestamp": "Thu, 26 Apr 2018 07:09:51 GMT",
            "template": "plan",
            "title": "Second activity",
            "description": "Another activity",
            "office": "OsUR4ANqFzfKxyWBCS0r"
        }
    },
    "allowedTemplates": {
        "0": "plan",
    },
    "from": "Fri, 31 Dec 1999 18:30:00 GMT",
    "upto": "Tue, 01 May 2018 07:35:20 GMT"
}
```

## Fields

Most of the fields follow the same naming scheme as with `/create`, `/update` and `/comment` endpoints, explaination for each one would be redundant.

* **addendum**: An object contianing chronilogically ordered addendums (updates) starting from the time which was passed in the request.

* **from**: UTC timestamp denoting time from which the updates were fetched in the server.

* **upto**: UTC timestamp denoting the time up to which the updates were found in the database.

* **allowedTemplates**: An object containing all the templates which the requester is allowed to create activities with.

## Query Parameters

The `/read` endpoint **requires** you to add a query paramter with with the unix timestamp denoting the time from which you want the updates in the response.

example: `.../read?from=1525170327665`

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `200`: OK: A comment was successfully added to the activity and there was nothing to send in the response body.

* `400`: BAD REQUEST: The request endpoint was not implemented or the query paramter was omitted.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `GET` is allowed for `/read`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.
