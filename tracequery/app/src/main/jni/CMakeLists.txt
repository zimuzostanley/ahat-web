cmake_minimum_required(VERSION 3.22)
project(trace_processor_jni)

# Path to perfetto source and pre-built static library.
# Build the library with:
#   cd /path/to/perfetto
#   third_party/gn/gn gen out/android_arm64 --args='target_os="android" target_cpu="arm64" is_debug=false'
#   third_party/ninja/ninja -C out/android_arm64 src/trace_processor:trace_processor
set(PERFETTO_ROOT "/home/zimvm/projects/perfetto" CACHE PATH "Perfetto source root")
set(PERFETTO_LIB "${PERFETTO_ROOT}/out/android_arm64/libtrace_processor.a" CACHE FILEPATH "Pre-built trace_processor")

# Import pre-built trace_processor static library (326MB, all deps included)
add_library(trace_processor STATIC IMPORTED)
set_target_properties(trace_processor PROPERTIES
    IMPORTED_LOCATION "${PERFETTO_LIB}"
)

# Our JNI shared library
add_library(trace_processor_jni SHARED
    trace_processor_jni.cc
)

target_include_directories(trace_processor_jni PRIVATE
    "${PERFETTO_ROOT}/include"
    "${PERFETTO_ROOT}"
    "${PERFETTO_ROOT}/buildtools/abseil-cpp"
    "${PERFETTO_ROOT}/out/android_arm64/gen"
    "${PERFETTO_ROOT}/out/android_arm64/gen/build_config"
)

target_link_libraries(trace_processor_jni
    trace_processor
    android
    log
    z
)

set_target_properties(trace_processor_jni PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
)
