import os
import json, yaml
import time

def main_loop(cmd):
    os.system(cmd)
    #os.system("./discover_arb.sh")

    f = open("./bot/arb.json")

    arb = json.load(f)

    if(arb["isFound"] == "1"):
        print(f"Arb Found with Direction={arb['direction']} and Amount={arb['amount']}")
    else:
        print(f"Arb not found")



config = yaml.load(open("./config.yaml"), Loader=yaml.Loader)

fbn = "" if config["fork"]["block_number"] == "" else f"--fork-block-number {config['fork']['block_number']}"

cmd = f"forge script bot/rebalancer-bot.sol:MyScript --fork-url {config['secrets']['alchemy_key']} {fbn} --ffi"

n = config['tentatives']

print(f"cmd = {cmd}")

deltaT = 1

for i in range(n):
    print(f"Start")
    main_loop(cmd)
    print(f"Sleep {deltaT} seconds")
    time.sleep(deltaT)


