# Upstream libc++abi always builds its dynamic_cast/typeid implementation,
# even with exceptions disabled. Make that optional for this no-RTTI runtime.
set(path "${LLVM_SOURCE_DIR}/libcxxabi/src/CMakeLists.txt")
file(READ "${path}" contents)
if(NOT contents MATCHES "option\\(LIBCXXABI_ENABLE_RTTI")
  set(original "  private_typeinfo.cpp\n)")
  string(FIND "${contents}" "${original}" location)
  if(location EQUAL -1)
    message(FATAL_ERROR "Unsupported libc++abi source layout in ${path}")
  endif()
  set(replacement ")\n\noption(LIBCXXABI_ENABLE_RTTI \"Build the dynamic_cast and typeid runtime\" ON)\nif(LIBCXXABI_ENABLE_RTTI)\n  list(APPEND LIBCXXABI_SOURCES private_typeinfo.cpp)\nendif()")
  string(REPLACE "${original}" "${replacement}" contents "${contents}")
  file(WRITE "${path}" "${contents}")
endif()
