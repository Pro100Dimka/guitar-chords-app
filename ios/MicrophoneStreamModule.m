// MicrophoneStreamModule.m
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ScreenOrientation, NSObject)
RCT_EXTERN_METHOD(setLandscape:(BOOL)enabled)
@end

@interface RCT_EXTERN_MODULE(MicrophoneStream, RCTEventEmitter)

RCT_EXTERN_METHOD(setKeepAwake:(BOOL)enabled)
RCT_EXTERN_METHOD(startRecording)
RCT_EXTERN_METHOD(stopRecording)
RCT_EXTERN_METHOD(restartRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setTargetNotes:(NSArray *)notes)
RCT_EXTERN_METHOD(getSampleRate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getBufPerSec:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)


@end

@interface RCT_EXTERN_MODULE(SongRecognition, NSObject)
RCT_EXTERN_METHOD(recognizeMicrophone:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(recognizePlayback:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getRecognitionSource:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeResult:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumeLaunchURL:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(recognizeFile:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
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
RCT_EXTERN_METHOD(prepareGuitar:(NSString *)key wave:(NSString *)wave)
RCT_EXTERN_METHOD(prepareFingering:(NSString *)key wave:(NSString *)wave resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(playPreparedGuitar:(NSString *)key)
RCT_EXTERN_METHOD(playGuitarString:(NSString *)key index:(NSInteger)index)
RCT_EXTERN_METHOD(stopGuitarString:(NSInteger)index)
RCT_EXTERN_METHOD(setMetronome:(double)tempo enabled:(BOOL)enabled phase:(double)phase)
RCT_EXTERN_METHOD(setMetronomePattern:(double)tempo enabled:(BOOL)enabled phase:(double)phase beats:(double)beats)
RCT_EXTERN_METHOD(playMetronomeBeat:(double)accent volume:(double)volume)
RCT_EXTERN_METHOD(stopMetronomeBeats)
@end
