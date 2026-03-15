cmake_minimum_required(VERSION 3.22)
project(trace_processor_jni)

# Perfetto source root and pre-built library path.
# Set via gradle.properties or cmake arguments:
#   PERFETTO_ROOT: path to perfetto source checkout
#   PERFETTO_LIB: path to libtrace_processor.a
#
# Build the library:
#   cd $PERFETTO_ROOT
#   third_party/gn/gn gen out/android_arm64 --args='target_os="android" target_cpu="arm64" is_debug=false'
#   third_party/ninja/ninja -C out/android_arm64 src/trace_processor:trace_processor

if(NOT DEFINED PERFETTO_ROOT)
    # Default: assume perfetto is sibling to the repo root
    set(PERFETTO_ROOT "${CMAKE_SOURCE_DIR}/../../../../../../perfetto" CACHE PATH "Perfetto source root")
endif()

if(NOT DEFINED PERFETTO_LIB)
    set(PERFETTO_LIB "${PERFETTO_ROOT}/out/android_arm64/libtrace_processor.a" CACHE FILEPATH "Pre-built trace_processor")
endif()

add_library(trace_processor STATIC IMPORTED)
set_target_properties(trace_processor PROPERTIES IMPORTED_LOCATION "${PERFETTO_LIB}")

add_library(trace_processor_jni SHARED trace_processor_jni.cc)

target_include_directories(trace_processor_jni PRIVATE
    "${PERFETTO_ROOT}/include"
    "${PERFETTO_ROOT}"
    "${PERFETTO_ROOT}/buildtools/abseil-cpp"
    "${PERFETTO_ROOT}/out/android_arm64/gen"
    "${PERFETTO_ROOT}/out/android_arm64/gen/build_config"
)

target_link_libraries(trace_processor_jni trace_processor android log z)

set_target_properties(trace_processor_jni PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
