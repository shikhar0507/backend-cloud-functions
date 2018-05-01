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
