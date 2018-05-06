# Creating a new activity

**Endpoint**: `/app/activities/create`

**Method**: POST

## Example request body

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

## Minimal request body

Here's an example of the least amount of fields that you can use to create an activity.

```json
    "template": "plan",
    "timestamp": 1520015400000,
    "office": "OsUR4ANqFzfKxyWBCS0r",
    "geopoint": [80.2333, 30.3434],
```

Such a request will create an activity where the requester will be the only assignee to the activity with no title and description in the activity.

Of course, you can always send a request to `/update` with the activity-id of this activity to update anything in this activity.

## Fields

* **templateId**: A non-null non-empty string containing the id of the template with which you want to create the activity with.

* **timestamp**: A non-null non-empty `Number` (`long` for Java) containing the Unix timestamp denoting the time at which you hit the endpoint.

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

* **schedule**: A nullable array containing the schedules you want to add to the activity.

  * Can be an empty array.

  * Only `name`, `startTime`, and `endTime` fields are accepted. Anything else will be ignored.

  * A schedule without `startTime` will be ignored. All other fields are optional.

****

## Responses

Regardless of whether your request was fulfilled or if there was an error, you will receive a response. Here are the ones which you should handle.

* `201`: CREATED: The activity was successfully created on the server with the request body you sent.

* `400`: BAD REQUEST: The request endpoint was not implemented or the json payload was non-conformant.

* `403`: FORBIDDEN: The requester doesn't have the authority to make the request.

* `405`: METHOD NOT ALLOWED: Only `POST` is allowed for `/create`.

* `500`: INTERNAL SERVER ERROR: Probably an issue with the cloud function. Please create an issue.

## Notes

A few things you should consider while creating a request on `/create`:

### Phone Numbers

While adding assignees to the request body, please make sure that the phone number you put for each of them follows the [E.164
](https://en.wikipedia.org/wiki/E.164) standard.

You don't really need to read the whole standard to make a valid create request. Basically, the gist of the article is in the following points:

1. Numbers are limited to a maximum of 15 digits, excluding the international call prefix.

2. Numbers should start with a '+' character.

3. There should be no spaces/dashes or any other special characters in between the digits

And, lastly, just for your convenience, here's are a few examples which you can use to validate the phone numbers in Java and Javascript.

* For Javascript

    ``` javascript
    const re = new RegExp(/^\+?[1-9]\d{5,14}$/);

    console.log(re.test('+919810385815')); // true
    console.log(re.test('919810385815')); // false
    console.log(re.test('+91 981 038 5815')) // false
    ```

* For Java

    ```java
    import java.util.regex.Pattern;
    import java.util.regex.Matcher;

    public class MatcherExample {
        public void isPhoneNumberValid(phoneNumber) {
            String patternString = "/^\+?[1-9]\d{5,14}$/";
            Pattern pattern = Pattern.compile(patternString);
            return pattern.matcher(phoneNumber).matches();
        }

        System.out.println(isPhoneNumberValid("+919810385815")); // true;
        System.out.println(isPhoneNumberValid("919810385815")); // false;
        System.out.println(isPhoneNumberValid("+91 981 038 5815")); // false;
    }
    ```
