# Cloud Functions for Growthfile

This is the repository for all the documentation for the Firebase cloud functions.

## Endpoints

There is a single endpoint which you can hit with your client in order to make a request.

```/app```

On this endpoint, you have resources which you can target depending on which type of request you want to make.

Below are the listed resources:

* `/app/activities`: contains action related to creating, updating and adding a comment to an activity.

* `/app/services`: contains helper services like getting a contact from the database for the client.

* `/app/now`: returns the server timestamp in a `GET` request.

## Resources

You can check out the `/JSON` subfolder in this repository to get a help document on how to consume whatever API you want to read/write data from/to.

## Sending Requests

* Javascript

  * Using XHR

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

  * Using fetch()

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

## LICENSE

MIT LICENSE

Copyright (c) Growthfile 2018
