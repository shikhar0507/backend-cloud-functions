# Cloud Functions for Growthfile

This is the repository for cloud functions running on Firebase Growthfile backend.

## File Structure

```bash
|   .firebaserc
|   .gitignore
|   firebase.json
|   LICENSE
|   README.md
|
\---functions
    |   .eslintrc.json
    |   index.js
    |   package-lock.json
    |   package.json
    |
    +---admin
    |       admin.js
    |       utils.js
    |
    +---auth
    |   |   onCreate.js
    |   |   onDelete.js
    |   |
    |   \---user
    |           onRead.js
    |           onUpdate.js
    |
    +---firestore
    |   \---activity
    |           helperLib.js
    |           onComment.js
    |           onCreate.js
    |           onRead.js
    |           onUpdate.js
    |
    \---server
            onActivity.js
            onService.js
            server.js
```

## Installation

* Download and install [Node 6.11.5](https://nodejs.org/download/release/v6.11.5/) on your device.

* Install firebase-tools and firebase-admin.

    ```bash
    npm install -g firebase-tools firebase-admin
    ```

* Clone this repository

    ```bash
    git clone https://github.com/Growthfilev2/cloud-functions
    ```

* `cd` into the functions directory.

    ```bash
    cd cloud-functions
    ```

* Install the dependencies

    ```bash
    npm install
    ```

* Deploy the functions

    ```bash
    firebase deploy --only functions
    ```

## Endpoints

There is a single endpoint which you can hit with your client in order to make a request.

    ```/app```

On this endpoint, you have resources which you can target depending on which type of request you want to make.

Listed below, are the main resources where you can hit your request.

* `/app/activities`: contains action related to creating, updating and adding a comment to an activity.

* `/app/services`: contains helper services like getting a contact from the database for the client.

* `/app/now`: returns the server timestamp in a `GET` request.

## Sending Requests

* Using Javascript XHR

```javascript
var data = JSON.stringify('/* JSON string here */');
var url = '/* url endpoint here */';

var xhr = new XMLHttpRequest();
xhr.withCredentials = true;

xhr.addEventListener('readystatechange', () => {
    if (this.readyState === 4) {
        /* success */
        console.log(this.responseText);
    }
});

xhr.open('POST', url);
xhr.setRequestHeader('Content-Type', 'application/json');
/* https://firebase.google.com/docs/auth/admin/create-custom-tokens */
xhr.setRequestHeader('Authorization', '/* auth token string */');
xhr.setRequestHeader('Cache-Control', 'no-cache');
xhr.send(data);
```

* Using Javascript fetch

```javascript
    const url = '/* url endpoint here */';
    const body = {}; // add body data here

    const postData = (url, body) => {
        return fetch(url, {
            body: JSON.stringify(data),
            cache: 'no-cache',
            method: 'POST',
            mode: 'cors',
            headers: {
                'Authorization': 'Bearer ' + getBearer(),
                'Content-Type': 'application/json',
            },
        }).then((response) => {
            return response.json();
        }).catch(console.log);
    };

    postData(url, body).then((data) => {
        /* do something with json data */
    });
```

## Collections

These are the resources at the `/app/...` endpoint where you can target your request.

**COMMON FIELDS IN REQUEST BODY**: There are many fields which are common among the accepted requests.

* **timestamp**: A non-null non-empty `Number` (`long` for Java) containing the Unix timestamp denoting the time at which you hit the endpoint.

* **geopoint**: A non-empty array containing the latitude and longitude of the client at the time of creating the activity.

    * form: [`lat`, `lng`]

    * lat range: -90 <= `lat` <= 90

    * lng range: -180 <= `lng` <= 180

* **title**: A nullable string (can be empty) with the title of the activity.

* **description**: A nullable string (can be empty) with the description of the activity.

* **venue**: A nullable array containing the venues you want to add to the activity.

    * Venue can be an empty array.

    * Only `venueDescriptor`, `location`, `geopoint`, and `address` fields are accepted. Anything else will be discarded.

    * A venue object without the `geopoint` field will be ignored. All other fields are optional.

* **schedule**: A nullable array containing the schedules you want to add to the activity.

    * Can be an empty array.

    * Only `name`, `startTime`, and `endTime` fields are accepted. Anything else will be ignored.

    * A schedule without `startTime` will be ignored. All other fields are optional.


### `/activities`

All operations related to creating, updating and adding a comment to an activity are in the `/activities` path.

#### Creating an Activity

**ENDPOINT**: `/app/activities/create`

**Method**: POST

**QUERY PARAMETERS**: None

**FULL REQUEST BODY**: Request body with all possibly accepted fields

```json
{
    "template": "plan",
    "timestamp": 1520015400000,
    "office": "personal",
    "geopoint": [80.2333, 30.3434],
    "title": "Title of the activity",
    "description": "Description of the activity.",
    "assignTo": [
        "+919090909090",
        "+919019191919"
    ],
    "venue": [{
        "venueDescriptor": "where",
        "location": "location name",
        "geopoint": [80.80,90.0],
        "address": "address of the venue"
    },
    {
        "venueDescriptor": "invalid venue",
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
        "name": "Invalid Schedule", // startTime > endTime here. This schedule will be ignored
        "startTime": 1520274600000,
        "endTime": 1520188200000
    }]
}
```

**MINIMUM REQUEST BODY**: Fields which are required in every request

```json
{
    "template": "plan",
    "timestamp": 1520015400000,
    "office": "OsUR4ANqFzfKxyWBCS0r",
    "geopoint": [80.2333, 30.3434]
}
```
Such a request will create an activity where the requester will be the only assignee to the activity with no title and description in the activity.

Of course, you can always send a request to `.../update` with the activity-id of this activity to update anything in this activity assuming you have the permission to edit.

**FIELDS**

* **templateId**: A non-null non-empty string containing the id of the template with which you want to create the activity with.

* **officeId**: A non-null non-empty string containing the id of the office with which you want to create the activity with.

* **assignTo**: A nullable array containing the phone numbers of all the participants of the activity.

    * Only valid phone numbers will be added to the activity in creation.

    * Make sure to add a `+` to each of the phone numbers. See notes below for more details.

**POSSIBLE RESPONSES**

* `201`: CREATED: The activity was successfully created on the server with the request body you sent.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `POST` is allowed for `/create`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue in the issues tab with the request body.

#### Updating an Activity

**Endpoint**: `/app/activities/update`

**Method**: PATCH

**QUERY PARAMETERS**: None

**MINIMUM REQUEST BODY**

```json
{
    "activityId": "gnCuHnQQOvQGsWtFxmqQ",
    "timestamp": 1522598642000,
    "geopoint": [80.2333, 30.3434]
}
```

This request will only add an addendum to the activity with the updated time and geopoint coords that you sent in the request body.

**FULL REQUEST BODY**

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

**FIELDS**

* **activityId**: A non-null non-empty string containing the id of the activity which you want to update.

* **addAssignTo**: A nullable array containing the phone numbers of all the participants of the activity.

    * Only valid phone numbers will be added to the activity in creation.

* **deleteAssignTo**: A nullable array containing the phone numbers of all the participants of the activity which you want to remove.

**POSSIBLE RESPONSES**

* `204`: NO CONTENT: The activity was updated successfully and there was nothing to send in the response body.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `PATCH` is allowed for `/update`.

* `409`: CONFLICT: A document with the activity-id you sent in the request doesn't exist.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab with the request body.

#### Adding a New Comment.

**ENDPOINT**: `/app/activities/comment`

**METHOD**: POST

**QUERY PARAMETERS**: None

**FULL REQUEST BODY**

```json
{
    "activityId": "2k4qI3W39sKIDZedcOaM",
    "timestamp": 1522598642000,
    "geopoint": [80.2333, 30.343],
    "comment": "An example comment"
}
```

**FIELDS**

* **comment**: A non-null non-empty string containing the comment which you add to the activity.

**POSSIBLE RESPONSES**

* `201`: CREATED: A document with the comment in from the request has been created successfully.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `POST` is allowed for `/comment`.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab with the request body.

#### Reading the Activities

**ENDPOINT**: `/app/activities/read`

**METHOD**: GET

**QUERY PARAMETERS**: The `/read` endpoint **requires** you to add a query parameter with the Unix timestamp denoting the time from which you want the updates in the response.

```.../read?from=1525170327665```

**EXAMPLE RESPONSE BODY**

```json
{
    "addendum": [
        {
            "activityId": "zE52PotR1u94AmVcnqal",
            "comment": "+919999999999 created Plan",
            "timestamp": "2018-03-02T18:30:00.000Z",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+919999999999"
        },
        {
            "activityId": "r6saWivwkM5QQZXfLdVg",
            "comment": "+918000000000 created Plan",
            "timestamp": "2018-03-02T18:30:00.000Z",
            "location": [
                80.2333,
                30.3434
            ],
            "user": "+918000000000"
        }
    ],
    "activities": {
        "6EDaPe5BNjcJ0qQKLCg1": {
            "canEdit": true,
            "status": "PENDING",
            "schedule": {},
            "venue": {},
            "timestamp": "2018-04-01T16:04:02.000Z",
            "template": "plan",
            "title": "new updated title",
            "description": "new changed description",
            "office": "personal",
            "assignTo": [
                "+918111111111",
                "+919999999999",
            ]
        },
        "bgDIrjQPi5pN9Ph3qNZf": {
            "canEdit": true,
            "status": "PENDING",
            "schedule": {},
            "venue": {},
            "timestamp": "2018-05-06T17:06:43.718Z",
            "template": "plan",
            "title": "Title of the activity",
            "description": "Description of the activity.",
            "office": "personal",
            "assignTo": [
                "+918000000000",
                "+918111111111",
                "+919999999999",
            ]
        }
    },
    "templates": {
        "plan": {
            "schedule": {
                "endTime": "2018-04-25T06:29:54.401Z",
                "startTime": "2018-04-25T06:29:54.401Z",
                "name": "when"
            },
            "venue": {
                "address": "Rajpath Marg, India Gate, New Delhi 110001",
                "location": "India Gate",
                "venueDescriptor": "where",
                "geopoint": {
                    "_latitude": 28.612912,
                    "_longitude": 77.227321
                }
            },
            "template": "Plan",
            "comment": "Default template. Available to all users (group or not).",
            "status": "PENDING"
        }
    },
    "from": "1999-12-31T18:30:00.000Z",
    "upto": "2018-05-06T17:06:43.718Z"
}
```

**FIELDS**

Most of the fields follow the same naming scheme as with `/create`, `/update` and `/comment` endpoints, an explanation for each one again would be redundant.

* **addendum**: An object containing chronologically ordered addendums (updates) starting from the time which was passed in the request.

* **from**: Timestamp denoting time from which the updates were fetched in the server.

* **upto**: Timestamp denoting the time up to which the updates were found in the database.

* **templates**: An object containing all the templates which the requester is allowed to create activities with.

**POSSIBLE RESPONSES**

* `200`: OK: The request for fetching the data was successful.

* `400`: BAD REQUEST: The request endpoint was not implemented or the query parameter was omitted.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `GET` is allowed for `/read`.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab so that the issue can be reproduced.

### `/services`

Anything that is not related to activities is present in the `/services` collection.

#### Fetching multiple user profiles from Firebase auth

**ENDPOINT**: `/app/services/users/read`

**METHOD**: GET

The `/read` endpoint accepts an argument `q` which can either be an array or a single argument consisting of phone numbers of all the users you want to get the profiles of.

**Note**: The `+` character is represented by %2B in url encoded characters. Check out [W3Schools URL Encoding](https://www.w3schools.com/tags/ref_urlencode.asp) for more details.

**Request**: single phone number `.../app/services/users/read?q=%2B9090909090`

**EXAMPLE RESPONSE BODY**

```json
{
    "code": 200,
    "message": [
        {
            "+918090909090": { // user who exists
                "photoUrl": "https://example.com/profile.png",
                "displayName": "First Last ",
                "lastSignInTime": null
            }
        }
    ]
}
```

**REQUEST**: multiple phone numbers `.../app/services/users/read?q=%2B9090909090&q=%2B8010101010`

**RESPONSE**:

```json
{
    "code": 200,
    "message": [
        {
            "+918090909090": { // user who exists
                "photoUrl": "https://example.com/profile.png",
                "displayName": "First Last ",
                "lastSignInTime": null
            }
        },
        {
            "+919191919191": {} // a user who doesn't exist in the system
        }
    ]
}
```

**POSSIBLE RESPONSES**

* `200`: OK: The request for fetching the data was successful.

* `400`: BAD REQUEST: The endpoint you hit was probably spelled wrong.

* `405`: METHOD NOT ALLOWED: Only `GET` method is allowed for `/read`.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab so that the issue can be reproduced.

#### Updating your own auth (phone number)

**ENDPOINT**: `/app/services/users/update`

**METHOD**: PATCH

Allowing the update of your own phone number while logged in should not allowed directly via the client.

Any request for this kind of update need to be done via this https endpoint.

Any request for updating the phone number needs to have a non-empty request body with only a single field `phoneNumber`.

This phone number should be a valid [E.164](https://en.wikipedia.org/wiki/E.164) string.

**FULL REQUEST BODY**

```json
{
  "phoneNumber": "+919090909090"
}
```

**POSSIBLE RESPONSES**

* `202`: ACCEPTED: Users's was updated successfully.

* `400`: BAD REQUEST: Either the endpoint was wrong or the phone number in the request body was not valid.

* `409`: CONFLICT: The phone number you sent in the request body already exists in the sytem.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab so that the issue can be reproduced.

### `/now`

Returns the server timestamp

**ENDPOINT**: `/app/now`

**METHOD**: GET

```json
{
  "code": 200,
  "message": "Fri, 02 Mar 2018 18:30:00 GMT"
}
```

**POSSIBLE RESPONSES**

* `200`: OK: The request was successful.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `GET` is allowed for `/now`.

* `500`: INTERNAL SERVER ERROR: Please create an issue in the issues tab so that the issue can be reproduced.

## License

All the code and documentation is covered by the MIT License.
