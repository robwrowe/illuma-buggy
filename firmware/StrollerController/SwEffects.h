#pragma once

#include "Types.h"
#include <stdint.h>
#include <stddef.h>

bool wandCastIsDuplicateAdvert(const uint8_t* payload, size_t plen);
void rememberWandCast(const uint8_t* payload, size_t plen);
