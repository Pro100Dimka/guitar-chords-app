#include "NativeDSPModule.h"

#include <cmath>

namespace facebook::react
{

  NativeDSPModule::NativeDSPModule(std::shared_ptr<CallInvoker> jsInvoker)
      : NativeDSPModuleCxxSpec(std::move(jsInvoker)), yinInstance(nullptr) {}

  float NativeDSPModule::pitch(jsi::Runtime &rt, const std::vector<float> &input,
                               float sampleRate, float minFreq, float maxFreq,
                               float threshold)
  {
    // (re)initialize yinInstance
    if (!yinInstance || yinInstance->getBufferSize() != input.size() ||
        sampleRate != yinInstance->getSampleRate())
    {
      yinInstance = std::make_unique<Yin>(sampleRate, input.size());

      // Log on each initialization
      std::string message = string_format(
          "Creating YIN instance @%.2fHz | buffer size: %d",
          yinInstance->getSampleRate(), yinInstance->getBufferSize());
      log(rt, message);
    }

    auto pitch = yinInstance->getPitch(input, rt, minFreq, maxFreq, threshold);

    // Log pitch probability
    // auto prob_msg = string_format("Prob: %.2f", yinInstance->getProbability());
    // log(rt, prob_msg);

    return pitch;
  }

  float NativeDSPModule::rms(jsi::Runtime &rt, const std::vector<float> &input)
  {
    if (input.empty())
      return 0.0f; // защита от пустого массива

    double sumSquares = 0.0;
    for (float value : input)
    {
      float v = value;
      // если данные явно выходят за [-1, 1], считаем что это Int16
      if (std::abs(v) > 1.0f)
      {
        v /= 32768.0f; // нормализация Int16
      }
      sumSquares += v * v;
    }

    return static_cast<float>(std::sqrt(sumSquares / input.size()));
  }

} // namespace facebook::react