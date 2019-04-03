'use strict';


class Activity {
  constructor(params) {
    if (!params) {
      throw new Error('Missing params');
    }

    const {
      attachment,
      canEditRule,
      creator,
      hidden,
      office,
      officeId,
      schedule,
      venue,
      template,
      status,
      timezone,
      activityName,
    } = params;

    this.timestamp = Date.now();
    this.addendumDocref = null;
    this.attachment = attachment;
    this.canEditRule = canEditRule;
    this.creator = creator;
    this.hidden = hidden;
    this.office = office;
    this.officeId = officeId;
    this.schedule = schedule;
    this.venue = venue;
    this.template = template;
    this.status = status;
    this.timezone = timezone;
    this.activityName = activityName;
  }

  set setAddendumDocRef(addendumDocref) {
    this.addendumDocref = addendumDocref;
  }

  set setAttachment(attachment) {
    this.attachment = attachment;
  }

  set setVenue(venue) {
    this.venue = venue;
  }

  set setSchedule(schedule) {
    this.schedule = schedule;
  }

  set setStatus(status) {
    this.status = status;
  }

  get getActivityObject() {
    return this;
  }

  get getStatus() {
    return this.status;
  }

  get getCreator() {
    return this.creator;
  }

  get getCanEditRule() {
    return this.canEditRule;
  }

  get getAttachment() {
    return this.attachment;
  }

  get getOffice() {
    return this.office;
  }

  get getOfficeId() {
    return this.officeId;
  }
}

class Addendum {
  constructor(params) {
    const {
      action,
      activityData,
      activityName,
      geopointAccuracy,
      isSupportRequest,
      isAdminRequest,
      location,
      provider,
      user,
      userDeviceTimestamp,
    } = params;

    this.action = action;
    this.activityData = activityData;
    this.activityName = activityName;
    this.geopointAccuracy = geopointAccuracy;
    this.isSupportRequest = isSupportRequest;
    this.isAdminRequest = isAdminRequest;
    this.location = location;
    this.provider = provider;
    this.timestamp = Date.now();
    this.user = user;
    this.userDeviceTimestamp = userDeviceTimestamp;
  }

  set setAction(action) {
    this.action = action;
  }

  set setActivityData(activityData) {
    this.activityData = activityData;
  }

  set setActivityName(activityName) {
    this.activityName = activityName;
  }

  set setGeopointAccuracy(geopointAccuracy) {
    this.geopointAccuracy = geopointAccuracy;
  }

  set setIsSupportRequest(isSupportRequest) {
    this.isSupportRequest = isSupportRequest;
  }

  set setIsAdminRequest(isAdminRequest) {
    this.isAdminRequest = isAdminRequest;
  }

  set setUser(user) {
    this.user = user;
  }

  set setUserDeviceTimestamp(userDeviceTimestamp) {
    this.userDeviceTimestamp = userDeviceTimestamp;
  }
}

module.exports = {
  Activity,
  Addendum,
};
