// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;


import "forge-std/Test.sol";

interface AggregatorInterface {
  function latestAnswer() external view returns (int256);
  function latestTimestamp() external view returns (uint256);
  function latestRound() external view returns (uint256);
  function getAnswer(uint256 roundId) external view returns (int256);
  function getTimestamp(uint256 roundId) external view returns (uint256);

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
  event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);
}

interface AggregatorV3Interface {

  function decimals() external view returns (uint8);
  function description() external view returns (string memory);
  function version() external view returns (uint256);

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );

}

interface AggregatorV2V3Interface is AggregatorInterface, AggregatorV3Interface
{
}

struct OracleData {
      uint80 roundId;
      int256 answer;
      uint256 startedAt;
      uint256 updatedAt;
      uint80 answeredInRound;
}

struct OracleStatus {
    int256 latestAnswer;
    uint256 latestTimestamp;
    uint256 latestRound;
}



/**
 * @title A trusted proxy for updating where current answers are read from
 * @notice This contract provides a consistent address for the
 * CurrentAnwerInterface but delegates where it reads from to the owner, who is
 * trusted to update it.
 */
contract MockAggregatorProxy is AggregatorV2V3Interface {

    // NOTE: Real Aggregator Address 0x13e3ee699d1909e989722e753853ae30b17e08c5
    address public realAggregator;

    mapping(uint256 => OracleData) public oracleData;
    OracleStatus public oracleStatusInitial;
    OracleStatus public oracleStatusCurrent;
    bool public enableOverride;

    function _takeOracleStatus() internal {
        oracleStatusInitial.latestAnswer = latestAnswer();
        oracleStatusInitial.latestTimestamp = latestTimestamp();
        oracleStatusInitial.latestRound = latestRound();

        oracleStatusCurrent = oracleStatusInitial;
    }

    function _takeOracleData() internal {
        OracleData memory _oracleData;
        (
            _oracleData.roundId,
            _oracleData.answer,
            _oracleData.startedAt,
            _oracleData.updatedAt,
            _oracleData.answeredInRound
        ) = latestRoundData();

        oracleData[_oracleData.roundId] = _oracleData;
    }

    function setRealAggregator(address _realAggregator) external {
        realAggregator = _realAggregator;
        _takeOracleStatus();
        _takeOracleData();
    }

    function setEnableOverride(bool _enableOverride) external {
        enableOverride = _enableOverride;
    }

    function getLatestAnswer() external returns(int256) {
        return oracleData[oracleStatusCurrent.latestRound].answer;
    }

    function advance(uint256 deltaT, int256 answer) external {
        uint80 roundId = oracleData[oracleStatusCurrent.latestRound].roundId + 1;
        OracleData storage _oracleData = oracleData[roundId];
        _oracleData.answeredInRound = roundId-1;
        _oracleData.roundId = roundId;
        _oracleData.answer = answer;
        _oracleData.startedAt += deltaT;
        _oracleData.updatedAt += deltaT;

        oracleStatusCurrent.latestAnswer = answer;
        oracleStatusCurrent.latestTimestamp += deltaT;
        oracleStatusCurrent.latestRound = roundId;
        console.log("[Oracle advance()] oracleStatusCurrent.latestRound = ", oracleStatusCurrent.latestRound);
    }

    function decimals() external view override returns (uint8) {
        return AggregatorV2V3Interface(realAggregator).decimals(); 
    }

    function description() external view override returns (string memory) {
        return AggregatorV2V3Interface(realAggregator).description(); 
    }

    function version() external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).version(); 
    }

    function latestAnswer() public view override returns (int256) {
        return oracleStatusCurrent.latestAnswer;
    }

    function latestTimestamp() public view override returns (uint256) {
        return oracleStatusCurrent.latestTimestamp;
    }


    function latestRound() public view override returns (uint256) {
        return oracleStatusCurrent.latestRound;
    }

    function getAnswer(uint256 roundId) external view override returns (int256) {
        return (roundId >= oracleStatusInitial.latestRound) ? oracleData[roundId].answer : AggregatorV2V3Interface(realAggregator).getAnswer(roundId);
    }

    function getTimestamp(uint256 roundId) external view override returns (uint256) {
        return AggregatorV2V3Interface(realAggregator).getTimestamp(roundId);
    }




    function getRoundData(uint80 _roundId)
    external
    view 
    override
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        if(_roundId < oracleStatusInitial.latestRound) {
            return AggregatorV2V3Interface(realAggregator).getRoundData(_roundId);
        } else {
            return (
                oracleData[_roundId].roundId, 
                oracleData[_roundId].answer, 
                oracleData[_roundId].startedAt, 
                oracleData[_roundId].updatedAt, 
                oracleData[_roundId].answeredInRound
                );
        }
    }


    function latestRoundData()
    public
    view
    override 
    returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
            return (
                oracleData[oracleStatusCurrent.latestRound].roundId, 
                oracleData[oracleStatusCurrent.latestRound].answer, 
                oracleData[oracleStatusCurrent.latestRound].startedAt, 
                oracleData[oracleStatusCurrent.latestRound].updatedAt, 
                oracleData[oracleStatusCurrent.latestRound].answeredInRound
                );
    }


}

