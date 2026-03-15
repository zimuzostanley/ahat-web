cmake_minimum_required(VERSION 3.22)
project(trace_processor_jni)

# Path to the pre-built trace_processor static library built via perfetto's GN.
# Build it with:
#   cd /path/to/perfetto
#   third_party/gn/gn gen out/android_arm64 --args='target_os="android" target_cpu="arm64" is_debug=false'
#   third_party/ninja/ninja -C out/android_arm64 src/trace_processor:trace_processor
#
# The resulting .a file is at: out/android_arm64/obj/src/trace_processor/trace_processor.a
set(PERFETTO_ROOT "${CMAKE_SOURCE_DIR}/../../../../../../perfetto"
    CACHE PATH "Path to perfetto source root")
set(PERFETTO_BUILD_DIR "${PERFETTO_ROOT}/out/android_arm64"
    CACHE PATH "Path to perfetto build output for android arm64")

# Import pre-built trace_processor static library
add_library(trace_processor STATIC IMPORTED)
set_target_properties(trace_processor PROPERTIES
    IMPORTED_LOCATION "${PERFETTO_BUILD_DIR}/obj/src/trace_processor/trace_processor.a"
)

# Also need libc++ static from the NDK (perfetto links against it)
# The protobuf and sqlite dependencies are statically linked into trace_processor.a
# when built with complete_static_lib=true

# Our JNI shared library
add_library(trace_processor_jni SHARED
    trace_processor_jni.cc
)

target_include_directories(trace_processor_jni PRIVATE
    "${PERFETTO_ROOT}/include"
    "${PERFETTO_ROOT}"
    "${PERFETTO_ROOT}/buildtools/abseil-cpp"
)

target_link_libraries(trace_processor_jni
    trace_processor
    android
    log
    z      # zlib
)

# Use C++17 to match perfetto
set_target_properties(trace_processor_jni PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
)
