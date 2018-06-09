# Reading A Template

endpoint: `/api/services/templates/read`

method: `GET`

query parameter: `?name=name of the template` (optional)

## Full Response Body for Single Template

This is a response for the request which has the template name in the request body.

```json
{
    "venue": {
        "location": "India Gate",
        "venueDescriptor": "where",
        "geopoint": {
            "_latitude": 28.612912,
            "_longitude": 77.227321
        },
        "address": "Rajpath Marg, India Gate, New Delhi, Delhi 110001"
    },
    "defaultTitle": "plan",
    "schedule": {
        "endTime": "1999-12-31T18:30:00.000Z",
        "startTime": "1999-12-31T18:30:00.000Z",
        "name": "when"
    },
    "attachment": {},
    "name": "plan",
    "comment": "'Default template. Available to all users(group or not)",
    "statusOnCreate": "PENDING"
}
```

## Full Response Body Without Query String

Upon omitting the `query` in the request URL, the API will send all the templates in the response.

> This response is just an example. Actual data may vary from time to time.

```json
{
    "leave": {
        "attachment": {
            "to": "2018-05-23T18:30:00.000Z",
            "from": "2018-05-22T18:30:00.000Z",
            "employeeId": "",
            "name": ""
        },
        "defaultTitle": "leave",
        "schedule": {
            "endTime": "2018-05-22T18:30:00.000Z",
            "startTime": "2018-05-22T18:30:00.000Z",
            "name": ""
        },
        "name": "leave",
        "comment": "Template used for employee leaves",
        "statusOnCreate": "PENDING",
        "title": "leave",
        "venue": {
            "venueDescriptor": "",
            "geopoint": {
                "_latitude": 0,
                "_longitude": 0
            },
            "address": "",
            "location": ""
        },
        "include": [
            "manager",
            "hr"
        ]
    },
    "plan": {
        "defaultTitle": "plan",
        "schedule": {
            "endTime": "1999-12-31T18:30:00.000Z",
            "startTime": "1999-12-31T18:30:00.000Z",
            "name": "when"
        },
        "attachment": {},
        "name": "plan",
        "comment": "'Default template. Available to all users(group or not)",
        "statusOnCreate": "PENDING",
        "venue": {
            "location": "India Gate",
            "venueDescriptor": "where",
            "geopoint": {
                "_latitude": 28.612912,
                "_longitude": 77.227321
            },
            "address": "Rajpath Marg, India Gate, New Delhi, Delhi 110001"
        }
    },
    "Customer product number maintenance": {
        "title": "Customer product number maintenance",
        "venue": {
            "venueDescriptor": "where",
            "geopoint": "",
            "address": "",
            "location": ""
        },
        "include": [
            ""
        ],
        "attachment": {
            "salesOrder": "",
            "product": "",
            "dateOfPurchase": "2018-05-22T18:30:00.000Z"
        },
        "defaultTitle": "product maintenance",
        "schedule": {
            "endTime": "2018-05-23T18:30:00.000Z",
            "startTime": "2018-05-22T18:30:00.000Z",
            "name": ""
        },
        "name": "Customer product number maintenance",
        "comment": "Template created for customer product maintenance",
        "statusOnCreate": "PENDING"
    }
}
```

## Preconditions

* Only the users who have `manageTemplates` set to `true` in their `customClaims` can read templates from the Firestore.
