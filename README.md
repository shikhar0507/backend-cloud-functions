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
  cd backend-cloud-functions
  ```

- Install the dependencies

  ```bash
  npm install
  ```

- Add the service account key from Firebase console to `/functions/admin/` directory.

- Deploy the functions

  ```bash
  firebase deploy --only functions
  ```

## Api Documentation

- Refer to the [Routes](/functions/routes/index.js) file for details.

## Running Local Queries

- Running local queries requires you to have a [service account key](https://firebase.google.com/support/guides/service-accounts). Put the key.json file in the `functions/admin` directory.
- Use the `firebase serve` command to run a local http server.
- The url will look something like this:

```curl
http://localhost:5001/{project-name}/us-central1/api
```

- Use [Postman](https://www.getpostman.com/) to run the api endpoint.

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

- Api keys and config is stored in the path [functions](./functions/admin/example.env.js).

## Cloudflare Workers

| Type                                                                         | Name        |
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
    "X-CF-Secret": "6hut0pf8by22m5sxvim1i8"
  };

  console.log("authorization:", req.headers.get("Authorization"));
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
    console.log("body", body);

    options.body = JSON.stringify(body);
  }

  const result = await fetch(mainUrl, options);

  return result;
}

addEventListener("fetch", event => {
  console.clear();
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
    "X-CF-Secret": "6hut0pf8by22m5sxvim1i8"
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

## License

All the code and documentation is covered by the [MIT License](./LICENSE).
