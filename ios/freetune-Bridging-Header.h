//freetune-Bridging-Header.h
#if __has_include(<React/RCTBridgeModule.h>)
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLinkingManager.h>
#endif
#include <stdint.h>
char *freetune_fingerprint(const int16_t *samples, uintptr_t count);
void freetune_fingerprint_free(char *uri);
void *freetune_chords_new(void);
int freetune_chords_push(void *handle, const int16_t *samples, uintptr_t count);
char *freetune_chords_finish(void *handle);
void freetune_chords_free(void *handle);
