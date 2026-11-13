FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY apps/server/pom.xml ./pom.xml
COPY apps/server/src ./src
RUN mvn -B -ntp package

FROM eclipse-temurin:21-jre
RUN mkdir /data && chown 10001:10001 /data
COPY --from=build /build/target/neuink-server-*.jar /app/neuink-server.jar
USER 10001:10001
WORKDIR /app
EXPOSE 8790
ENTRYPOINT ["java", "-jar", "/app/neuink-server.jar"]
