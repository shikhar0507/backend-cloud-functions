# Cloud Functions for Growthfile

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

This is the repository for cloud functions running on Firebase Growthfile back-end

## Installation

- Download and install [Node 8](https://nodejs.org/dist/latest-v8.x/) on your device.

- Install firebase-tools and firebase-admin.

  ```bash
  npm install -g firebase-tools firebase-admin
  ```

- Clone this repository

  ```bash
  git clone https://github.com/Growthfilev2/backend-cloud-functions
  ```

- `cd` into the functions directory.

  ```bash
  cd backend-cloud-functions/functions
  ```

- Put cashfree `.pem` keys in `/functions/admin`.

```bash
# payout_test.pem => non-production
# payout_prod.pem => production
```

- Install the dependencies

  ```bash
  npm install
  ```

- Add the service account key from Firebase console to `/functions/admin/` directory.

- Select firebase project

```bash
firebase use --add <project-name>
```

- Deploy the functions

  ```bash
  firebase deploy --only functions
  ```

## Api Documentation

- Refer to the [Routes](/functions/routes/index.js) file for details.

## Running Local Queries

- Running local queries requires you to have a [service account key](https://firebase.google.com/support/guides/service-accounts). Put the `key.json` file in the `functions/admin` directory.
- Use the `firebase serve` command to run a local http server.
- The url will look something like this:

```curl
http://localhost:5001/{project-name}/us-central1/api
```

- Use [Postman](https://www.getpostman.com/) or [curl](https://curl.haxx.se/docs/) to run the api endpoint.

## Example of running a query

- Example Task: Find all templates with `hidden = 0` in the root collection `ActivityTemplates`.
- Here's how you would do it.

1. Open [server.js](/functions/server/server.js).
2. Comment out the following code:

```js
return checkAuthorizationToken(conn);
```

3 Write the following:

```js
// Query
const docs = await rootCollections.activityTemplates
  .where("hidden", "==", 0)
  .get();

// Result
docs.forEach(doc => {
  console.log(doc.id, doc.get("name"));
});

// End the response, otherwise the api will timeout
// after 60 seconds
sendResponse(conn, 200);
```

4 Open the terminal and use `curl` to invoke the API function.

## Environment Variables

- Api keys and config is stored in the directory [functions/admin/](./functions/admin/example.env.js).
- In production, create a copy of this file as `env.js`.

## Mocking a user in `/api`

- Open `server.js` from the path [functions/server/server.js]('./functions/server/server.js').
- On the bottom, comment out the codeblock

```js
if (
  env.isProduction &&
  (!conn.req.headers["x-cf-secret"] ||
    conn.req.headers["x-cf-secret"] !== env.cfSecret)
) {
  return sendResponse(
    conn,
    code.forbidden,
    `Missing 'X-CF-Secret' header in the request headers`
  );
}

return checkAuthorizationToken(conn);
```

- Replace this with the following:

```js
const uid = /** uid from auth of the user to mock */;
return getUserAuthFromIdToken(conn, { uid });
```

- Mock with curl/postman.

## Cloudflare Workers

| Route                                                                        | Worker      |
| ---------------------------------------------------------------------------- | ----------- |
| [https://api2.your-domain.com/api/\*](https://api2.your-domain.com/api/*)    | main_worker |
| [https://api2.your-domain.com/getUser](https://api2.your-domain.com/getUser) | get_user    |
| [https://api2.your-domain.com/webapp](https://api2.your-domain.com/webapp)   | webapp      |

### main_worker

```js
const getUrlParts = requestUrl => {
  const mainApiUrl = `{cloud-functions-url}/api`;
  const parts = requestUrl.split("https://api2.your-domain.com/api");

  return [mainApiUrl, parts[1]];
};

async function handleRequest(req) {
  const [partOne, partTwo] = getUrlParts(req.url);

  const newHeaders = {
    /** The pre-flight headers */
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "OPTIONS, HEAD, POST, GET, PATCH, PUT, DELETE",
    "Access-Control-Allow-Headers":
      "X-Requested-With, Authorization," + "Content-Type, Accept",
    "Content-Type": "application/json",
    "Content-Language": "en-US",
    "Cache-Control": "no-cache",
    "X-CF-Secret": "" // from env.
  };

  newHeaders.Authorization = req.headers.get("Authorization");

  if (!partOne || !partTwo) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Bad request",
        code: 400
      }),
      {
        headers: newHeaders,
        status: 400
      }
    );
  }

  const mainUrl = `${partOne}${partTwo}`;
  const options = {
    method: req.method,
    headers: newHeaders
  };

  if (req.method === "OPTIONS" || req.method === "HEAD") {
    return new Response("{}", {
      headers: newHeaders,
      status: 200,
      statusText: "working"
    });
  }

  if (req.method !== "GET") {
    const body = await req.json();
    options.body = JSON.stringify(body);
  }

  const result = await fetch(mainUrl, options);

  return result;
}

addEventListener("fetch", event => {
  const result = handleRequest(event.request);

  event.respondWith(result);
});
```

### get_user

```js
const getUrlParts = requestUrl => {
  const mainApiUrl = `{cloud-functions-url}/getUser`;
  const parts = requestUrl.split("https://api2.your-domain.com/getUser");

  return [mainApiUrl, parts[1]];
};

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Fetch and log a request
 * @param {Request} request
 */
async function handleRequest(req) {
  const headers = {
    "Access-Control-Allow-Origin": "https://your-domain.com",
    "Access-Control-Allow-Methods": "OPTIONS, GET",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
    "X-CF-Secret": "" // from env.
  };

  const [part1, part2] = getUrlParts(req.url);

  if (!part1 || !part2) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Bad request",
        code: 400
      }),
      {
        headers,
        status: 400
      }
    );
  }

  if (req.method !== "GET") {
    return new Response("{}", {
      headers,
      status: 405,
      statusText: `${req.method} is not allowed. Use GET`
    });
  }

  if (req.method === "OPTIONS" || req.method === "HEAD") {
    return new Response("{}", {
      headers,
      status: 204,
      statusText: ""
    });
  }

  const mainUrl = `${partOne}${partTwo}`;

  const responseFromApi = await fetch(mainUrl, {
    method: "GET",
    headers
  });

  return responseFromApi;
}
```

### webapp

```js
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Fetch and log a request
 * @param {Request} request
 */
async function handleRequest(request) {
  console.log("Got request", request);
  const response = await fetch(request);
  console.log("Got response", response);
  return response;
}
```

## Schema

This is the schema for main collection/subcollection objects in the database.

### Activity

Path: `Activities/{autoId}`

```jsonc
{
  "activityName": <String>,
  // This object always looks like the
  // Activitie's parent template
  "attachment": {
    [<field>]: {
      value: <Array | Number | String>,
      "type": <String>
    }
  },
  // Firestore doc reference
  // for the path `Offices/{officeId}/Addendum/{autoId}`
  "addendumDocRef": <Object | null>
  "canEditRule": <"NONE" | "ALL" | "EMPLOYEE" | "ADMIN" | "CREATOR">,
  // Unix timestamp in ms of the activity creation event.
  "createTimestamp"?: <Number>,
  // Details about the creator of this activity. The string value will be a phone number
  "creator": <{"displayName": <String>, "phoneNumber": <String>, "photoURL": "String"} | String>,
  // Hidden is copied straight from the template that this activity belongs to.
  "hidden": <0 | 1>,
  // Name of the office
  "office": <String>,
  // ActivityId of the office doc.
  "officeId": <String>,
  // Array of objects in the form
  // eg => [{name: "Duty", "startTime": 1578578853986, endTime: 1578578853986}]
  "schedule": <Array({"name": <String>, "startTime": <String| Number>, "endTime": <String | Number>})>,
  // Copied straight from the template which this activity belongs to.
  "status": <"CONFIRMED" | "PENDING" | "CANCELLED">,
  // Template name
  "template": <String>,
  // Timestamp at which this activity was last touched. Equals to the creation timestamp
  // if activity has been created.
  "timestamp": <Number>,
  "timezone": <String>,
  "venue": <Array({"venueDescriptor": <String>, "location": <String>, "address": <String>, "geopoint": {"latitude": <String | Number>, "longitude": <String | Number>}})>,
}
```

### Template

Path: `ActivityTemplates/{autoId}`

```jsonc
{
  "attachment": <Object>,
  "canEditRule": <"NONE" | "ALL" | "EMPLOYEE" | "ADMIN" | "CREATOR">,
  "comment": <String>,
  "hidden": <0 | 1>,
  "name": <String>,
  "schedule": [
    {"name": <String>, "startTime": "", "endTime": ""}
  ],
  "statusOnCreate": <"CONFIRMED" | "PENDING" | "CANCELLED">,
  "timestamp"?: <Number>,
  "venue": [
    {
      "venueDescriptor": <String>,
      "location": "",
      "address": "",
        "geopoint": {
          "latitude": "" ,
          "longitude": ""
        }
    }
  ],
  "report"?: <String | undefined>
}
```

### Recipient

Path: `Recipients/{recipientActivityId}`

```jsonc
{
  "cc": <String>,
  "include": <Array(String)>,
  "office": <String>,
  "officeId": <String>,
  "report": <String>,
  "status": <String>,
  "timestamp": <Number>
}
```

### Timer

Path: `Timers/{DD-MM-YYYY}`

```jsonc
{
  "apiUrl"?: <String | undefined>,
  "backblazeAuthorizationToken"?: <String | undefined>,
  "downloadUrl": <String | undefined>,
  "timestamp": <Number>,
  "sent": <Boolean>,
  "cashfree": {
    "payout": {
      "token": <String>
    },
    "autocollect": {
      "token": <String>
    }
  }
}
```

### Update

Path: `Updates/{uid}`

```jsonc
{
  "deviceIdsArray":? Array<String>,
  "deviceIdsObject":? {
    [<deviceId>]: {
      "count": <Number>,
      "timestamp": <Number>
    }
  },
  "idProof"?: {
    "aadhar": {
      "back": <String>,
      "front": <String>,
      "number": <Number>
    },
    "pan": {
      "front": <String>,
      "number": <Number>
    }
  },
  "lastNowRequestTimestamp"?: <Number | undefined>,
  "latestAppVersion":? <Number | undefined>,
  "latestDeviceBrand":? <String | undefined>,
  "latestDeviceId":? <String | undefined>,
  "latestDeviceModel":? <String | undefined>,
  "latestDeviceOs":? <String | undefined>,
  "latestOsVersion":? <String | undefined>,
  "linkedAccounts":? [{
    "address1": <String>,
    "bankAccount": <String>,
    "ifsc": <String>
  }],
  "phoneNumber": <String>,
  "registrationToken":? <String | undefined>
}
```

## License

All the code and documentation is covered by the [MIT License](./LICENSE).
