export interface MinioEvent {
  EventName: string;
  Key: string;
  Records: MinioRecord[];
}

export interface MinioRecord {
  eventVersion: string;
  eventSource: string;
  awsRegion: string;
  eventTime: string;
  eventName: string;
  userIdentity: {
    principalId: string;
  };
  requestParameters: {
    principalId: string;
    region: string;
    sourceIPAddress: string;
  };
  responseElements: {
    'x-amz-id-2': string;
    'x-amz-request-id': string;
    'x-minio-deployment-id': string;
    'x-minio-origin-endpoint': string;
  };
  s3: {
    s3SchemaVersion: string;
    configurationId: string;
    bucket: {
      name: string;
      ownerIdentity: {
        principalId: string;
      };
      arn: string;
    };
    object: {
      key: string;
      size: number;
      eTag: string;
      contentType: string;
      userMetadata: {
        'content-type': string;
      };
      sequencer: string;
    };
  };
}
