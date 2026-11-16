//freetune-Bridging-Header.h
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#include <stdint.h>
char *freetune_fingerprint(const int16_t *samples, uintptr_t count);
void freetune_fingerprint_free(char *uri);
