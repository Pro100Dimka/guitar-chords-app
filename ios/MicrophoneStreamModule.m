// MicrophoneStreamModule.m
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(MicrophoneStream, RCTEventEmitter)

RCT_EXTERN_METHOD(startRecording)
RCT_EXTERN_METHOD(stopRecording)
RCT_EXTERN_METHOD(setTargetNotes:(NSArray *)notes)
RCT_EXTERN_METHOD(getSampleRate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getBufPerSec:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)


@end
