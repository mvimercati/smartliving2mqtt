#!/usr/bin/node

const net = require('net');

const client = net.createConnection({ host: "192.168.1.33", port: 9876 }, () => {
    console.log('Connected to server!');

    init();
});

client.on('end', () => {
    console.log('Disconnected from server');
});


var mqtt = require('mqtt');
var mqtt_client = mqtt.connect('mqtt://127.0.0.1',{clientId:"smartliving2mqtt",username:"mqtt_user",password:"mqtt"});
var mqtt_connected = false;

var zones = {
    5  : "Radar sala",
    4  : "Radar cucina",
    13 : "Finestra sala dx",
    11 : "Finestra sala sx",
    12 : "Finestra cucina",
    10 : "Finestra bagno p1",
    2  : "Finestra camera matrimoniale",
    0  : "Finestra bagno p2",
    3  : "Finestra cameretta",
    1  : "Finestra camera figlia",
    15 : "Radar taverna",
    16 : "Radar box",
    18 : "Porta box",
    17 : "Blindata ingresso",
    19 : "Finestra taverna"
};

var zonesLastValue = {};
var areasLastValue = {};

var queue = [];

const cmdType = {
    LOG_ELEM: 1,
    LOG_HEAD: 2,
    ZONE_STAT: 3,
    AREA_STAT: 4,
    CMD: 5
};

const areaCmd = {
    ARM: 1,
    STAY: 2,
    INST: 3
};

function calcCkSum(buffer, size)
{
    cksum = 0;

    for (i = 0; i < size; i++)
    {
	cksum += buffer[i];
    }
    
    return cksum & 0xFF;
}

var databuffer = Buffer.alloc(0);
var logHead = 0;

client.on('data', (recv_data) => {

//    console.log(databuffer.length , recv_data.length);
    
    databuffer = Buffer.concat([databuffer, recv_data]);


    while (queue.length != 0)
    {
//	console.log(queue);
	
	var size;
	
	cmd = queue[0];
	//console.log(cmd);
	
	switch (cmd) {
	case cmdType.LOG_ELEM:
	    size = 367;
	    break;
	    
	case cmdType.LOG_HEAD:
	    size = 5;
	    break;
	    
	case cmdType.ZONE_STAT:
	    size = 27;
	    break;
	    
	case cmdType.AREA_STAT:
	    size = 17;
	    break;
	    
	case cmdType.CMD:
	    size = 1;
	    break;
	    
	default:
	    return;
	}
	
	//data = client.read(size);
//	console.log("Read size "  + size);
	if (databuffer.length < size)
	{
	    console.log("no enough data");
	    return;
	}
	
	data = databuffer.slice(0, size)
	databuffer = databuffer.slice(size);


	
	console.log(data);
	
	queue.shift();
	

	if (cmd != cmdType.CMD) {
	    
	    ckSum = calcCkSum(data, data.length - 1);
	
	    if (ckSum != data[data.length - 1])
	    {	
		console.log("");
		console.log("!!! Checksum error !!! " + ckSum + " " + data[data.length - 1]);
		console.log("");
		return;
	    }
	}
	
	
	switch(cmd) {
	
	case cmdType.LOG_ELEM:
	    var datetime = new Date(2000,0,1);
	    datetime.setSeconds((data[3] << 24) | (data[2] << 16) | (data[1] << 8) | data[0]);
	    console.log(datetime, data.toString('utf8',6,22), data.toString('utf8',26,42), data.toString('utf8',46,62));
	    break;
	    
	case cmdType.LOG_HEAD:
	    logHead = data[1] << 8 | data[0];
	    console.log("Log head " + logHead);
	    break;
	    
	case cmdType.ZONE_STAT:
	    
	    zone = 0;
	    for (i = 0; i < 25; i++)
	    {

		for(n = 0; n < 8; n+=2)
		{
		    
		    if (!(zone in zones))
		    {
			zone++;
			continue;
		    }
		    
		    zone_name = zones[zone];
		    
		    
		    value = (data[i] >> n) & 3;

		    if (!(zone in zonesLastValue) || (zonesLastValue[zone] != value))
		    {
			zonesLastValue[zone] = value;
		    
			switch (value) {
			case 0:
			    console.log('Zone ' + zone + ': Short ('+ zone_name +')');
			    mqtt_publish("Inim/Zone/"+zone, "Short");
			    break;
			case 1:		
			    console.log('Zone ' + zone + ': Closed('+ zone_name +')');
			    mqtt_publish("Inim/Zone/"+zone, "Closed");
			    break;
			case 2:
			    console.log('Zone ' + zone + ': Open('+ zone_name +')');
			    mqtt_publish("Inim/Zone/"+zone, "Open");
			    break;
			case 3:
			    console.log('Zone ' + zone + ': Tamper('+ zone_name +')');
			    mqtt_publish("Inim/Zone/"+zone, "Tamper");
			    break;
			}
		    }
			
		    zone++;
		}
	    }
	    break;
	    
	case cmdType.AREA_STAT:
	    
	    for (area = 0; area < 10; area++)
	    {
		armed = (data[Math.floor(area/2)] >>> (((area % 2) * 4))) & 0xF
		switch (armed) {
		case 1:
		    armeds = 'Armed';
		    break;
		case 2:
		    armeds = 'Stay ';
		    break;
		case 3:
		    armeds = 'Insta';
		    break;
		case 4:
		    armeds = 'None ';
		    break;
		default:
		    armeds = armed
		    break;
		}
		
		alarm = (data[ area < 8 ? 6 : 7] >>> (area % 8)) & 1;
		
		tamper = (data[ area < 8 ? 8 : 9] >>> (area % 8)) & 1;
		
		alarm_mem = (data[ area < 8 ? 10 : 11] >>> (area % 8)) & 1;

		tamper_mem = (data[ area < 8 ? 12 : 13] >>> (area % 8)) & 1;
	
		auto_arm = (data[ area < 8 ? 14 : 15] >>> (area % 8)) & 1;
		
		value = "{ \"armed\" : \""+ armeds +"\", \"alarm\" : \""+ alarm +"\", \"tamper\" : \""+ tamper +"\", \"alarm_mem\" : \""+ alarm_mem +"\", \"tamper_mem\" : \""+ tamper_mem +"\", \"auto_arm\" : \""+ auto_arm +"\" }";

		if (!(area in areasLastValue) || (areasLastValue[area] != value))
		{
		    console.log('Area ' + area + ' armed=' + armeds + ' alarm=' + alarm + ' tamper=' + tamper + ' alarm_mem=' + alarm_mem + ' tamper_mem=' + tamper_mem + ' auto_arm=' + auto_arm);
		    areasLastValue[area] = value;
		    mqtt_publish("Inim/Area/"+area, value);
		}
	    }
	    
	    
	    break;
	
	case cmdType.CMD:
	    if (data[0] != queue[0]) {
		console.log("Checksum error "+ data[0] + " " + queue[0]);
	    }
	    else {
		console.log("Checksum ok");
	    }
	    queue.shift;
	    break;
	}
    }    
});

function setArmed(area, value)
{
    write_cmd_area_buf[8] = 0;
    write_cmd_area_buf[9] = 5;
    write_cmd_area_buf[10] = 2;
    write_cmd_area_buf[11] = 9;
    write_cmd_area_buf[12] = 255;
    write_cmd_area_buf[13] = 255;

    offset = 14 + Math.floor(area/2);
    write_cmd_area_buf[offset] = ((area % 2) == 0 ? value & 0xF : (value << 4 ) & 0xF0);

    client.write(write_cmd_area_buf);
    queue.push(cmdType.CMD);
    queue.push(calcCkSum(write_cmd_area_buf, write_cmd_area_buf.length));
}



const read_zone_status_buf = Buffer.from("0000002001001a3b", 'hex');
const read_area_status_buf = Buffer.from("0000002000001030", 'hex');
const read_log_elem_buf = Buffer.from("0000001FFF000000", 'hex');
const read_log_head_buf = Buffer.from("0000001FFE000421", 'hex');
const write_cmd_area_buf = Buffer.from("0100002006000E350000000000000000000000000000", 'hex');


var cnt = 0;

setInterval(function() {

    // Wait response before a new request
    if (queue.length != 0) {
	return;
    }

    switch (cnt) {
    case 0:
	client.write(read_zone_status_buf);
	queue.push(cmdType.ZONE_STAT);
	break;
    case 1:	
	client.write(read_area_status_buf);
	queue.push(cmdType.AREA_STAT);
	break;	
    case 2:
	prevLogHead = logHead;
	client.write(read_log_head_buf);
	queue.push(cmdType.LOG_HEAD);
	break;
    case 3:
    case 4:
    case 5:
    case 6:
	i = logHead + 2 - cnt;
	read_log_elem_buf[5] = (i >> 8) & 0xFF;
        read_log_elem_buf[6] = i & 0xFF;
        read_log_elem_buf[read_log_elem_buf.length - 1] = calcCkSum(read_log_elem_buf, read_log_elem_buf.length - 1);

	client.write(read_log_elem_buf);
        queue.push(cmdType.LOG_ELEM);
	break;
    default:
	break;
    }

    cnt = (cnt + 1) % 2; //20;
    
}, 1000); // every 10s poll zone status


setInterval(function() {

    zonesLastValue = {};
    areasLastValue = {};

    console.log("Clear");
    
}, 600 * 1000); // every 600s refresh all sensors


setInterval(function() {

//    setArmed(0, areaCmd.ARM);
    
}, 5);


mqtt_client.on('connect', function() {
    console.log("Connected to MQTT broker");
//    mqtt_client.subscribe('Viessmann/Commands/#', function(err) {
//	console.log(err);
//    });
//    console.log("Done");
    mqtt_connected = true;
});


mqtt_client.on('message', function(topic, message) {

    console.log("------- Command topic " + topic + " -> " + message);

//    if (topic.endsWith("HotWaterEnabled"))
//    {
//        if (message == "OFF")
//        {
//            last_enabled_temp = cmds["HotWaterTempTarget"][2];
//        }
//        write("HotWaterTempTarget", message == "OFF" ? "20" : last_enabled_temp);
//        read("HotWaterTempTarget");
//        return;
//    }

});

function mqtt_publish(key, value)
{
//    console.log("MQTT Publish " + key + " : " + value);
    mqtt_client.publish(key, value);
}














function init()
{

}
