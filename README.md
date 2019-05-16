# Cloud Functions for Growthfile

This is the repository for cloud functions running on Firebase Growthfile back-end

## Installation

* Download and install [Node 6.11.5](https://nodejs.org/download/release/v6.11.5/) on your device.

* Install firebase-tools and firebase-admin.

    ```bash
    npm install -g firebase-tools firebase-admin
    ```

* Clone this repository

    ```bash
    git clone https://github.com/Growthfilev2/backend-cloud-functions
    ```

* `cd` into the functions directory.

    ```bash
    cd backend-cloud-functions
    ```

* Install the dependencies

    ```bash
    npm install
    ```

* Add the service account key from Firebase console to `/functions/admin/`

* Deploy the functions

    ```bash
    firebase deploy --only functions
    ```

## Endpoints

There is a single endpoint which you can hit with your client in order to make a request.

```/api```

On this endpoint, you have resources which you can target depending on which type of request you want to make.

Listed below, are the main resources where you can hit your request.

* `/api/activities`: contains action related to creating, updating and adding a comment to an activity.

* `/api/services`: contains helper services like getting a contact from the database for the client.

* `/api/now`: returns the server timestamp in a `GET` request.

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

## Getting a Unix Timestamp

* Javascript

    * Current timestamp:

    ```javascript
    const ts = Date.now();
    console.log(ts); // output --> 1527311424251
    ```

    * Date timestamp

    ```javascript
    const ts = Date.parse(new Date('DD MM YYYY'));
    console.log(ts);
    ```

* Java

    * Current timestamp

    ```java
    final long ts = System.currentTimeMillis() / 1000L;
    System.out.println(ts);
    ```

    * Date timestamp

    ```java
    final String dateString = "Fri, 09 Nov 2012 23:40:18 GMT";
    final DateFormat dateFormat = new SimpleDateFormat("EEE, dd MMM yyyy hh:mm:ss z");
    final Date date = dateFormat.parse(dateString);
    final long ts = (long) date.getTime() / 1000;
    System.out.println(ts); // output --> 1527311424251
    ```

## License

All the code and documentation is covered by the [MIT License](./LICENSE).
