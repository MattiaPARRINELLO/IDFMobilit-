const loaderDiv = document.getElementById("loaderDiv");
async function getApiKey() {
    try {
        const response = await fetch("/DataSet/apikey.json");
        let data = await response.json();
        data = data.APIKey;
        return data;
    } catch (error) {
        console.error("Error:", error);
        return null;
    }
}
const APIUrl = "https://prim.iledefrance-mobilites.fr/marketplace"


//getstations data from city name, limit is the numer of results
//if no limit is set, all results are returned
//return an array of objects
async function getStations(cityName, limit = 0) {
    try {
        const response = await fetch("/DataSet/arrets.json");
        const stop = await response.json();
        const resultats = stop.filter(station => station.arrname.toLowerCase().includes(cityName.toLowerCase()));
        if (resultats.length <= 0) {
            console.error("No station found");
            loading(false)
            return null;
        }
        if (limit > 0) {
            return resultats.slice(0, limit);
        }
        return resultats;
    } catch (error) {
        console.error("Error:", error);
        return [];
    }
}

// get line data from lineID, return an object
async function getLineData(lineID) { //lineID format : C02711 of STIF:Line::C02711:
    const simpleLineIDPattern = /^C\d{5}$/;
    const lineIDPattern = /^STIF:Line::C\d{5}:$/;
    if (!simpleLineIDPattern.test(lineID)) {
        if (!lineIDPattern.test(lineID)) {
            console.error("Invalid lineID format : ", lineID);
            return null;
        }
        // convert full lineID to simple lineID
        lineID = lineID.slice(11, 17);
    }
    try {
        const response = await fetch("./DataSet/lignes.json");
        const linesData = await response.json();
        const resultats = linesData.filter(line => line.id_line === lineID);
        if (resultats[0].picto === null) {
            resultats[0].picto = {
                url: "https://upload.wikimedia.org/wikipedia/fr/thumb/f/f3/Logo_Transilien_%28RATP%29.svg/1024px-Logo_Transilien_%28RATP%29.svg.png",
                width: "100",
                height: "100",
                mimetype: "image/png"
            }
        }
        let returnData = {
            id: resultats[0].id_line || "unknown",
            name: resultats[0].name_line || "unknown",
            accentColor: resultats[0].colourweb_hexa,
            textColor: resultats[0].textcolourweb_hexa,
            image: {
                url: resultats[0].picto.url || "unknown",
                width: resultats[0].picto.width || "unknown",
                height: resultats[0].picto.height || "unknown",
                mimetype: resultats[0].picto.mimetype || "unknown"
            }
        }
        return returnData;


    } catch (error) {
        console.error("An error occured : ", error);
    }
}

//Call the api to get the next departures from a station
//return an unformatted object
async function getFutureTrainDepartures(stationID) { //stationID format : STIF:StopPoint:Q:41087: or 41087
    const fullStationIDPattern = /^STIF:StopPoint:Q:\d{5,6}:$/;
    if (!fullStationIDPattern.test(stationID)) {
        const shortStationIDPattern = /^\d{5,6}$/;
        if (!shortStationIDPattern.test(stationID)) {
            console.error("Invalid station ID format : ", stationID);
            return 'error';
        }
        stationID = `STIF:StopPoint:Q:${stationID}:`;
    }
    console.log(stationID)
    const url = `${APIUrl}/stop-monitoring?MonitoringRef=${stationID}`
    let apiKey = await getApiKey();
    let response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'apikey': apiKey
        }
    })
    response = await response.json()
    return response
}



//format the next departures data
//return an array of objects (departures)
async function formatNextDepartures(data) { //data is the object returned by getFutureTrainDepartures
    let returnData = [];
    const mainData = data.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;
    console.log(mainData)
    for (const info of mainData) {
        console.groupCollapsed("####---New Departure---####")
        let isLive = true
        console.log(info.MonitoredVehicleJourney.LineRef.value)
        let lineData = await getLineData(info.MonitoredVehicleJourney.LineRef.value)
        let arrivalTemp = 0;
        // Set default value for ArrivalPlatformName if undefined
        if (!info.MonitoredVehicleJourney.MonitoredCall.ArrivalPlatformName) {
            info.MonitoredVehicleJourney.MonitoredCall.ArrivalPlatformName = { value: "ND" };
        }

        // Determine the arrival time
        if (info.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime) {
            arrivalTemp = info.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime;
        } else {
            arrivalTemp = info.MonitoredVehicleJourney.MonitoredCall.AimedArrivalTime ||
                info.MonitoredVehicleJourney.MonitoredCall.ExpectedDepartureTime;
            isLive = false;
        }


        // If the train destination is the station itself, skip the train
        if (info.MonitoredVehicleJourney.DestinationName[0].value === info.MonitoredVehicleJourney.MonitoredCall.StopPointName[0].value) {
            console.log("---Skipping train---")
            console.log("Destination is the same as the station")
            console.log("##################")
            console.groupEnd()
            continue;
        }

        let arrival = new Date(arrivalTemp)
        let now = new Date()
        let diff = arrival - now
        if (diff < 0 || diff > 3600000 || diff == NaN) {
            console.log("---Skipping train---")
            console.log("Train is too early or too late")
            console.log("##################")
            console.groupEnd()
            continue;
        }

        let diffMinutes = Math.floor(diff / 60000);
        let diffSeconds = Math.floor((diff % 60000) / 1000);
        diff = `${diffMinutes}m ${diffSeconds}s`;
        if (diffMinutes == 1) {
            diff = "A l'approche"
        } else if (diffMinutes == 0) {
            diff = "Départ imminent"
        }

        let departure = new Date(info.MonitoredVehicleJourney.MonitoredCall.ExpectedDepartureTime)
        let timeAtStation = departure - arrival
        timeAtStation = Math.floor(timeAtStation / 1000) + "s";
        if (timeAtStation == "0s") {
            timeAtStation = null
        }
        let misson = ""
        console.log(info.MonitoredVehicleJourney.JourneyNote.length)
        if (info.MonitoredVehicleJourney.JourneyNote.length == 0) {
            console.log("No mission")
            misson = ""
        }
        else {
            misson = info.MonitoredVehicleJourney.JourneyNote[0].value
        }
        if (info.MonitoredVehicleJourney.JourneyNote == undefined) {
            info.MonitoredVehicleJourney.JourneyNote[0] = { value: "" }
        }
        tempData = {
            line: lineData,
            direction: info.MonitoredVehicleJourney.DestinationName[0].value,
            mission: misson,
            atStop: info.MonitoredVehicleJourney.MonitoredCall.VehicleAtStop,
            arrivalAtStationEXP: info.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime,
            departureAtStationEXP: info.MonitoredVehicleJourney.MonitoredCall.ExpectedDepartureTime,
            arrivalAtStationAIM: info.MonitoredVehicleJourney.MonitoredCall.AimedArrivalTime,
            status: info.MonitoredVehicleJourney.MonitoredCall.ArrivalStatus,
            platform: info.MonitoredVehicleJourney.MonitoredCall.ArrivalPlatformName.value,
            trainLenght: info.MonitoredVehicleJourney.VehicleFeatureRef[0],
            arrivalIn: diff,
            arrivalTemp: arrivalTemp,
            timeAtStation: timeAtStation,
            isLive: isLive
        }
        returnData.push(tempData);
        console.log("Direction : ", tempData.direction)
        console.log("Mission : ", tempData.mission)
        console.log("Arrival in : ", tempData.arrivalIn)
        console.log("Platform : ", tempData.platform)
        console.log("Time at station : ", tempData.timeAtStation)
        console.log("Line : ", tempData.line.name)
        console.log("##################")
        console.groupEnd()

    }
    returnData.sort((a, b) => new Date(a.arrivalTemp) - new Date(b.arrivalTemp));
    return returnData;
}



function updateHour() {
    const date = new Date();
    const hours = date.getHours() < 10 ? `0${date.getHours()}` : date.getHours();
    const minutes = date.getMinutes() < 10 ? `0${date.getMinutes()}` : date.getMinutes();
    const seconds = date.getSeconds() < 10 ? `0${date.getSeconds()}` : date.getSeconds();
    const time = `${hours}:${minutes}:${seconds}`;

    document.getElementById('time').textContent = time;
}



setInterval(updateHour, 1000);

async function main(showLoader = true) {
    if (showLoader) {
        loading(true)
    }
    let querry = document.getElementById("city").value
    if (querry == "") {
        if (showLoader) {
            loading(false)
        }
        return
    }
    let stationID = await getStations(querry, 1)
    document.getElementById("city").value = stationID[0].arrname
    stationID = stationID[0].zdaid
    let data = await getFutureTrainDepartures(stationID)
    let departures = await formatNextDepartures(data)
    document.querySelectorAll('body > div').forEach(div => {
        if (!div.classList.contains('train-info') && !div.classList.contains('loaderDiv')) {
            div.remove();
        }
    });
    departures.forEach(element => {
        let color = "#ffffff"
        if (element.isLive) {
            color = "lightgreen"
        }
        let div = document.createElement("div")
        let platformTime = element.timeAtStation
        if (platformTime == null) {
            platformTime = ""
        }
        div.classList.add("trainContainer")
        div.innerHTML = `
        <div class="train-item">
            <div class="logo">
                <img src="${element.line.image.url}" alt="">
                <span>${element.mission}</span>
            </div>
            <div class = "destination">${element.direction}</div>
            <div class="time-station">${platformTime}</div>

            <div class = "time-info" style="color:${color}">${element.arrivalIn}</div>
        </div>
        <div class="platform">${element.platform}</div>
        <div style="display: none" class="data">${JSON.stringify(element)}</div>`


        document.body.appendChild(div);
    });
    if (showLoader) {
        loading(false)
    }


}


main()

document.getElementById("city").addEventListener("keypress", function (e) {
    if (e.key === 'Enter') {
        main()
    }
})
document.getElementById("city").addEventListener("keypress", createSearchSuggestions())


function loop() {
    document.querySelectorAll('body > div.trainContainer').forEach(div => {
        const data = JSON.parse(div.querySelector('.data').textContent);
        const timeInfo = div.querySelector('.time-info');
        const arrivalTime = new Date(data.arrivalTemp);
        const now = new Date();
        const diff = arrivalTime - now;

        if (diff < 0) {
            div.remove();
        } else {
            const diffMinutes = Math.floor(diff / 60000);
            const diffSeconds = Math.floor((diff % 60000) / 1000);
            if (diffMinutes == 1) {
                timeInfo.textContent = "A l'approche";
            }
            else if (diffMinutes == 0) {
                timeInfo.textContent = `Départ imminent`;
            }
            else {
                timeInfo.textContent = `${diffMinutes}m ${diffSeconds}s`;
            }
        }
    });
}

setInterval(loop, 1000);
setInterval(main(false), 60000);



function loading(isLoading) {
    if (isLoading) {
        loaderDiv.style.display = "flex";
    }
    else {
        loaderDiv.style.display = "none";
    }
}



async function createSearchSuggestions() {
    const input = document.getElementById("city");
    const suggestionsDiv = document.getElementById("suggestionContainer");
    console.log(suggestionsDiv)
    input.addEventListener("input", async function () {
        const value = input.value;

        let stations = await getStations(value, 15);
        let uniqueStations = [];
        const seenZdaids = new Set();
        if (stations.length > 1) {
            for (const station of stations) {
                if (!seenZdaids.has(station.zdaid)) {
                    uniqueStations.push(station);
                    seenZdaids.add(station.zdaid);
                }
            }
        }
        stations = uniqueStations;
        suggestionsDiv.innerHTML = "";
        stations.forEach(station => {
            const div = document.createElement("div");
            div.classList.add("suggestion");
            div.textContent = station.arrname;
            div.addEventListener("click", function () {
                console.log(station.arrname);
                input.value = station.arrname;
                suggestionsDiv.innerHTML = "";
                main();
            });
            console.log(div)

            suggestionsDiv.appendChild(div);
        });
    });

}




document.getElementById("city").addEventListener("blur", function () {
    setTimeout(() => {
        document.getElementById("suggestionContainer").innerHTML = "";
    }, 1000);
});
