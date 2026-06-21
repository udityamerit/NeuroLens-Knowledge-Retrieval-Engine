@echo off
set JAVA_HOME=C:\Users\Uditya\.jdks\openjdk-22.0.1
set PATH=%JAVA_HOME%\bin;%PATH%
echo Java: %JAVA_HOME%
java -version
echo.
echo Running Gradle assembleDebug...
call gradlew.bat assembleDebug --no-daemon --stacktrace 2>&1
