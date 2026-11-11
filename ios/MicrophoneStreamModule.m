// MicrophoneStreamModule.m
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(MicrophoneStream, RCTEventEmitter)

RCT_EXTERN_METHOD(setKeepAwake:(BOOL)enabled)
RCT_EXTERN_METHOD(startRecording)
RCT_EXTERN_METHOD(stopRecording)
RCT_EXTERN_METHOD(setTargetNotes:(NSArray *)notes)
RCT_EXTERN_METHOD(getSampleRate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getBufPerSec:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)


@end

@interface RCT_EXTERN_MODULE(PerformanceAudio, RCTEventEmitter)
RCT_EXTERN_METHOD(startTake:(NSString *)songId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopTake:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(listTakes:(NSString *)songId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(playTake:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopPlayback)
RCT_EXTERN_METHOD(deleteTake:(NSString *)path resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(playSuccess)
RCT_EXTERN_METHOD(playGuitar:(NSString *)wave)
@end
